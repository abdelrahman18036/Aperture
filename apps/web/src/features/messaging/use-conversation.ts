"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import type { AnyServerEvent } from "@repo/realtime-events";

import { api } from "@/lib/api";

import {
  useRealtimeApi,
  useRealtimeEvents,
  useRealtimeReady,
} from "@/features/realtime/provider";

import type { ConnectionState } from "./use-realtime";

export type Message = Schemas["Message"];

/**
 * One conversation's state.
 *
 * The whole design is: **`seq` is the truth, and everything reconciles to
 * it.** Messages are held in a Map keyed by `seq` and rendered in sorted
 * order, which makes the three hard cases fall out rather than need handling:
 *
 * - the socket delivers a message the sync also returns → same `seq`, one entry
 * - a retry creates nothing new → the server returns the original `seq`
 * - frames arrive out of order → sorting fixes it, because order is not arrival
 *
 * Optimistic sends are the one thing without a `seq` yet. They live in a
 * separate list keyed by `client_id` and disappear when a real message with
 * that `client_id` shows up — from the POST response *or* from the socket,
 * whichever wins the race.
 */

/** A message the server has not confirmed yet. */
export interface PendingMessage {
  client_id: string;
  body: string;
  /** An attachment already uploaded and processed, awaiting its message. */
  mediaId?: string | null;
  /** Set when the send failed and the user can retry. */
  failed: boolean;
}

export interface ConversationState {
  messages: Message[];
  pending: PendingMessage[];
  connection: ConnectionState;
  /** User ids currently typing, excluding you. */
  typing: string[];
  /** Everyone else has read up to and including this `seq`. 0 for nobody. */
  seenUpToSeq: number;
  /** Seed the read positions from the inbox payload. */
  setOthersRead: (positions: Record<string, number> | undefined) => void;
  /** Ids of the other members connected right now. */
  online: ReadonlySet<string>;
  /** Seed presence from the inbox payload. */
  setOnline: (ids: string[] | undefined) => void;
  loading: boolean;
  send: (body: string, mediaId?: string | null) => void;
  retry: (clientId: string) => void;
  /** Withdraw one of your own messages. Yours only — the service checks. */
  unsend: (seq: number) => void;
  noteTyping: () => void;
  loadOlder: () => void;
  hasOlder: boolean;
  /** The socket's call-signalling channel, so a call need not open its own. */
  sendCallSignal: (
    callId: string,
    signal: "offer" | "answer" | "ice" | "hangup",
    payload: unknown,
  ) => void;
  /** Point the same socket at a call's channel. */
  setCallIds: (callIds: readonly string[]) => void;
}

/** How long a typing indicator survives without a refresh. */
const TYPING_TTL_MS = 5_000;

/** Don't announce typing more than this often. */
const TYPING_THROTTLE_MS = 2_000;

function newClientId(): string {
  return crypto.randomUUID();
}

export function useConversation(
  conversationId: string,
  viewerId: string,
): ConversationState {
  const [bySeq, setBySeq] = useState<Map<number, Message>>(new Map());
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [typingUntil, setTypingUntil] = useState<Map<string, number>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  /** user id -> how far they have read. Seeded by the API, kept by the socket. */
  const [othersRead, setOthersRead] = useState<Map<string, number>>(new Map());
  /** Who else is connected. Same shape: seeded by the API, kept by the socket. */
  const [online, setOnline] = useState<Set<string>>(new Set());
  /** Set once a scrollback page comes back empty. See `hasOlder` below. */
  const [exhausted, setExhausted] = useState(false);

  /** The high-water mark this client actually holds. The resync cursor. */
  const lastSeq = useRef(0);
  const oldestSeq = useRef<number | null>(null);
  const lastTypingSentAt = useRef(0);

  const absorb = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;

    setBySeq((current) => {
      const next = new Map(current);
      for (const message of incoming) next.set(message.seq, message);
      return next;
    });

    for (const message of incoming) {
      if (message.seq > lastSeq.current) lastSeq.current = message.seq;
      if (oldestSeq.current === null || message.seq < oldestSeq.current) {
        oldestSeq.current = message.seq;
      }
    }

    // Anything confirmed clears its optimistic twin, whichever path
    // delivered it — the POST response or the socket.
    const confirmed = new Set(incoming.map((m) => m.client_id));
    setPending((current) =>
      current.filter((item) => !confirmed.has(item.client_id)),
    );
  }, []);

  const drop = useCallback((seq: number) => {
    setBySeq((current) => {
      if (!current.has(seq)) return current;
      const next = new Map(current);
      next.delete(seq);
      return next;
    });
  }, []);

  /**
   * Fetch everything after the last `seq` we hold.
   *
   * Called on mount and on every reconnect. It is the entire offline story:
   * one index scan, no clock, no guesswork about what was missed.
   */
  const sync = useCallback(() => {
    void api
      .GET("/api/messaging/conversations/{conversation_id}/messages", {
        params: {
          path: { conversation_id: conversationId },
          query: { after: lastSeq.current },
        },
      })
      .then((response) => {
        setLoading(false);
        if (response.data === undefined) return;
        absorb(response.data.messages);
      });
  }, [absorb, conversationId]);

  const loadOlder = useCallback(() => {
    const before = oldestSeq.current;
    if (before === null || before <= 1) return;

    void api
      .GET("/api/messaging/conversations/{conversation_id}/messages", {
        params: {
          path: { conversation_id: conversationId },
          query: { before },
        },
      })
      .then((response) => {
        if (response.data === undefined) return;
        const page = response.data;
        if (page.messages.length === 0) {
          setExhausted(true);
          return;
        }
        absorb(page.messages);
      });
  }, [absorb, conversationId]);

  const onEvent = useCallback(
    (event: AnyServerEvent) => {
      if (event.type === "typing") {
        if (event.conversation_id !== conversationId) return;
        if (event.user_id === viewerId) return;
        setTypingUntil((current) => {
          const next = new Map(current);
          if (event.is_typing) next.set(event.user_id, Date.now() + TYPING_TTL_MS);
          else next.delete(event.user_id);
          return next;
        });
        return;
      }

      if (event.type === "message.created") {
        if (event.conversation_id !== conversationId) return;
        // The payload is the same DRF serializer the REST endpoint returns,
        // so its type is already generated — §3. The envelope types it as
        // `unknown` because only the caller knows which `type` it asked for.
        absorb([event.payload as Message]);
        return;
      }

      if (event.type === "message.deleted") {
        if (event.conversation_id !== conversationId) return;
        drop(event.seq);
        return;
      }

      if (event.type === "presence") {
        // The gateway announces arrivals and departures to every
        // conversation a socket is in. Your own is ignored — you know.
        if (event.user_id === viewerId) return;
        setOnline((current) => {
          const next = new Set(current);
          if (event.online) next.add(event.user_id);
          else next.delete(event.user_id);
          return next;
        });
        return;
      }

      if (event.type === "message.read") {
        if (event.conversation_id !== conversationId) return;
        // Your own read receipt tells you nothing you did not do yourself.
        const payload = event.payload as {
          user_id: string;
          last_read_seq: number;
        };
        if (payload.user_id === viewerId) return;
        setOthersRead((current) => {
          const seen = current.get(payload.user_id) ?? 0;
          // Never backwards. A reconnecting client can replay an older
          // position, and "seen" that un-sees itself is worse than late.
          if (payload.last_read_seq <= seen) return current;
          const next = new Map(current);
          next.set(payload.user_id, payload.last_read_seq);
          return next;
        });
      }

      // Anything else on this socket belongs to somebody else — calls, today.
      // Messaging is deliberately kept from knowing that.
    },
    [absorb, conversationId, drop, viewerId],
  );

  const seedOnline = useCallback((ids: string[] | undefined) => {
    setOnline(new Set(ids ?? []));
  }, []);

  const seedOthersRead = useCallback(
    (positions: Record<string, number> | undefined) => {
      // Guarded, because `Object.entries(undefined)` throws and took the
      // whole conversation down with it. A summary can arrive without this
      // — an older cached response, or a payload shape that changes again —
      // and a missing read position should mean "nothing seen yet", not a
      // blank screen with an error boundary behind it.
      setOthersRead(new Map(Object.entries(positions ?? {})));
    },
    [],
  );

  const unsend = useCallback(
    (seq: number) => {
      void api
        .DELETE(
          "/api/messaging/conversations/{conversation_id}/messages/{seq}",
          { params: { path: { conversation_id: conversationId, seq } } },
        )
        .then((response) => {
          // The socket also delivers `message.deleted` to everyone in the
          // conversation, including you, and `drop` is keyed by `seq` — so
          // doing it here as well is idempotent rather than duplicated. It
          // matters when the socket is down: without it the message stays on
          // screen after the server has already removed it.
          if (response.response.status === 204) drop(seq);
        });
    },
    [conversationId, drop],
  );

  const {
    state: connection,
    sendTyping,
    sendCallSignal,
    setCallIds,
    setConversationIds,
  } = useRealtimeApi();

  useRealtimeEvents(onEvent);
  // Every reconnect resyncs from the last `seq` we hold. The socket is a
  // delivery path, never a source of truth, so a drop costs one `?after=`.
  useRealtimeReady(sync);

  // Point the shared socket at this thread's ephemeral channel while it is on
  // screen, and let it go when it is not.
  useEffect(() => {
    setConversationIds([conversationId]);
    return () => setConversationIds([]);
  }, [conversationId, setConversationIds]);

  // Typing indicators expire on their own. A client that closed its laptop
  // mid-word must not leave "ada is typing" on screen forever.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTypingUntil((current) => {
        const live = [...current].filter(([, until]) => until > now);
        return live.length === current.size ? current : new Map(live);
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  // Read receipts: seeing the newest message is what marks it read.
  useEffect(() => {
    if (lastSeq.current === 0) return;
    const seq = lastSeq.current;
    void api.POST("/api/messaging/conversations/{conversation_id}/read", {
      params: { path: { conversation_id: conversationId } },
      body: { up_to_seq: seq },
    });
  }, [bySeq, conversationId]);

  const post = useCallback(
    (clientId: string, body: string, mediaId?: string | null) => {
      void api
        .POST("/api/messaging/conversations/{conversation_id}/messages", {
          params: { path: { conversation_id: conversationId } },
          body: { client_id: clientId, body, media_id: mediaId ?? null },
        })
        .then((response) => {
          if (response.data === undefined) {
            // Leave the optimistic message in place, marked failed. Dropping
            // it would lose what someone typed; retrying automatically with
            // the same client_id is safe but should be their choice.
            setPending((current) =>
              current.map((item) =>
                item.client_id === clientId ? { ...item, failed: true } : item,
              ),
            );
            return;
          }
          absorb([response.data.message]);
        });
    },
    [absorb, conversationId],
  );

  const send = useCallback(
    (body: string, mediaId?: string | null) => {
      const trimmed = body.trim();
      // An attachment is a message on its own. The service asks only that a
      // message have *something* in it, and requiring a caption to send a
      // photograph would be this client inventing a rule the API does not
      // have.
      if (trimmed === "" && !mediaId) return;

      // The client mints the id, and that is the whole duplicate story: a
      // retry after a timeout carries the same one and the unique constraint
      // turns it into a no-op.
      const clientId = newClientId();
      setPending((current) => [
        ...current,
        { client_id: clientId, body: trimmed, mediaId, failed: false },
      ]);
      post(clientId, trimmed, mediaId);
      sendTyping(conversationId, false);
    },
    [conversationId, post, sendTyping],
  );

  const retry = useCallback(
    (clientId: string) => {
      const item = pending.find((entry) => entry.client_id === clientId);
      if (item === undefined) return;
      setPending((current) =>
        current.map((entry) =>
          entry.client_id === clientId ? { ...entry, failed: false } : entry,
        ),
      );
      // Same client_id deliberately. If the first attempt actually landed,
      // the server returns that message instead of writing a second one.
      post(clientId, item.body, item.mediaId);
    },
    [pending, post],
  );

  const noteTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    sendTyping(conversationId, true);
  }, [conversationId, sendTyping]);

  const messages = useMemo(
    () => [...bySeq.values()].sort((a, b) => a.seq - b.seq),
    [bySeq],
  );

  const typing = useMemo(() => [...typingUntil.keys()], [typingUntil]);

  /**
   * The highest `seq` *everybody else* has read past.
   *
   * The minimum across members, not the maximum: in a group, "seen" should
   * mean seen by the room. Claiming a message was seen because one of six
   * people opened it is the kind of small lie that makes a read receipt
   * worth less than no read receipt.
   */
  const seenUpToSeq = useMemo(() => {
    const positions = [...othersRead.values()];
    return positions.length === 0 ? 0 : Math.min(...positions);
  }, [othersRead]);

  /**
   * Whether there is anything above the top of what we hold.
   *
   * Derived rather than assumed: holding `seq` 1 means we are at the start of
   * the conversation and there is nothing to fetch, so offering "earlier
   * messages" there is a button that cannot do anything. Deleted messages
   * leave gaps, so seq 1 may never be returned — hence `exhausted`, set when
   * a scrollback page actually comes back empty.
   */
  const hasOlder =
    !exhausted && messages.length > 0 && (messages[0]?.seq ?? 1) > 1;

  return {
    messages,
    pending,
    sendCallSignal,
    setCallIds,
    connection,
    typing,
    loading,
    send,
    retry,
    unsend,
    seenUpToSeq,
    setOthersRead: seedOthersRead,
    online,
    setOnline: seedOnline,
    noteTyping,
    loadOlder,
    hasOlder,
  };
}
