"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  anyServerEventSchema,
  type AnyServerEvent,
} from "@repo/realtime-events";

import { api } from "@/lib/api";

/**
 * The socket, and everything that has to be true about it.
 *
 * The connection is not the interesting part — reconnecting is. A socket that
 * works on a good network and loses messages on a bad one is worse than no
 * socket, because it looks like it is working. So the rules here are:
 *
 * 1. **The socket is a delivery path, never a source of truth.** Every
 *    durable event it carries also exists in Postgres behind a `seq`. If a
 *    frame is missed, `?after=` fetches it. Nothing is only ever delivered.
 * 2. **Reconnect always resyncs.** `connection.ready` fires a callback that
 *    refetches from the last `seq` the client actually holds — not from a
 *    timestamp, and not from what it *thinks* it should have.
 * 3. **Backoff, with jitter.** Ten thousand browsers reconnecting in lockstep
 *    after a deploy is a self-inflicted thundering herd.
 *
 * The ticket is fetched fresh for every connection attempt. It lives sixty
 * seconds, so a cached one is worthless by the second retry anyway.
 *
 * The whole connection lifecycle lives inside one effect. That is deliberate:
 * `connect` and `scheduleRetry` call each other, and as `useCallback`s that
 * is a declaration cycle held together by refs. As plain functions in an
 * effect it is just mutual recursion, and the socket is created exactly once
 * per mount — which matters, because a socket that reconnects on re-render is
 * a socket that resyncs constantly.
 */

/** Backoff schedule, in milliseconds. The last value repeats. */
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

/** Up to this much random extra, to break up synchronised reconnects. */
const JITTER_MS = 400;

/** Comfortably inside the gateway's 90s idle timeout and 75s presence TTL. */
const HEARTBEAT_MS = 30_000;

export type ConnectionState = "connecting" | "open" | "offline";

interface RealtimeOptions {
  /** Every durable and ephemeral event, already validated. */
  onEvent: (event: AnyServerEvent) => void;
  /**
   * Called whenever a *new* connection becomes ready — including the first.
   * This is the resync hook, and the reason no message is lost across a drop.
   */
  onReady: () => void;
}

export interface Realtime {
  state: ConnectionState;
  /** Tell the other side you are typing. Best effort; never queued. */
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  /**
   * Send one step of a call negotiation. Best effort, and deliberately so:
   * a queued ICE candidate that arrives after the call is a candidate for a
   * negotiation that no longer exists.
   */
  sendCallSignal: (
    callId: string,
    signal: "offer" | "answer" | "ice" | "hangup",
    payload: unknown,
  ) => void;
  /**
   * Point this socket at a call's signalling channel, or at none.
   *
   * Stable, and deliberately not a piece of React state: joining a call must
   * not have to travel back up through the component that owns the socket
   * before the subscription happens. The first offer can arrive within
   * milliseconds of the invite.
   */
  setCallIds: (callIds: readonly string[]) => void;
  /**
   * Point this socket at some conversations' ephemeral channels.
   *
   * A setter for the same reason `setCallIds` is one: the screen that wants a
   * subscription is not the component that owns the socket, and routing the
   * request back up through a render before it takes effect loses events in
   * the gap.
   */
  setConversationIds: (conversationIds: readonly string[]) => void;
}

export function useRealtime({ onEvent, onReady }: RealtimeOptions): Realtime {
  const [state, setState] = useState<ConnectionState>("connecting");

  const socket = useRef<WebSocket | null>(null);
  const wanted = useRef<readonly string[]>([]);
  const wantedCalls = useRef<readonly string[]>([]);

  // Effect events, so the effect below can call the latest handler without
  // listing it as a dependency. Without this, a parent re-render that changes
  // a callback identity would tear down and rebuild the socket.
  const emit = useEffectEvent((event: AnyServerEvent) => {
    onEvent(event);
  });
  const ready = useEffectEvent(() => {
    onReady();
  });
  const pushSubscription = useCallback(() => {
    const live = socket.current;
    if (live?.readyState !== WebSocket.OPEN) return;
    live.send(
      JSON.stringify({
        type: "subscribe",
        conversation_ids: [...wanted.current],
        call_ids: [...wantedCalls.current],
      }),
    );
  }, []);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleRetry(): void {
      if (stopped || retryTimer !== null) return;

      const step = Math.min(attempt, BACKOFF_MS.length - 1);
      // `?? 0` only satisfies the index check — `step` is clamped to the array.
      const delay = (BACKOFF_MS[step] ?? 0) + Math.random() * JITTER_MS;
      attempt += 1;

      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    }

    function connect(): void {
      if (stopped) return;
      setState((current) => (current === "open" ? "connecting" : current));

      void api.POST("/api/realtime/ticket", {}).then((response) => {
        if (stopped) return;

        if (response.data === undefined) {
          // No ticket means no session, or Django is down. Either way, retry
          // — a signed-out user simply keeps failing, which is correct.
          scheduleRetry();
          return;
        }

        const { ticket, url } = response.data;
        const ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
        socket.current = ws;

        ws.onopen = () => {
          attempt = 0;
        };

        ws.onmessage = (frame: MessageEvent<string>) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame.data);
          } catch {
            return;
          }

          const result = anyServerEventSchema.safeParse(parsed);
          if (!result.success) return;
          const event = result.data;

          if (event.type === "connection.ready") {
            setState("open");
            // Re-send whatever this client was subscribed to before the drop.
            // The refs survived it; the gateway's memory of them did not.
            pushSubscription();
            // Resync before anything else. Whatever arrived while the socket
            // was down is fetched by seq, so the gap closes itself.
            ready();
            // And then fall through rather than returning. This event names
            // the socket's owner, and the provider reads that to learn who is
            // signed in — returning here meant it never arrived, so
            // `viewerId` was permanently null and every consumer of it
            // silently behaved as though nobody was signed in.
          }

          emit(event);
        };

        ws.onclose = () => {
          socket.current = null;
          setState("offline");
          scheduleRetry();
        };

        ws.onerror = () => {
          // `onclose` always follows, so retrying is handled in one place.
          ws.close();
        };
      });
    }

    connect();

    const heartbeat = setInterval(() => {
      const live = socket.current;
      if (live?.readyState === WebSocket.OPEN) {
        live.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, HEARTBEAT_MS);

    // A browser that was backgrounded for an hour often holds a socket the OS
    // already killed. Coming back to the tab is the cheapest moment to notice.
    const revive = (): void => {
      if (document.visibilityState !== "visible") return;
      if (socket.current === null && retryTimer === null) {
        attempt = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", revive);
    window.addEventListener("online", revive);

    return () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", revive);
      window.removeEventListener("online", revive);
      socket.current?.close();
      socket.current = null;
    };
    // `emit`, `ready` and `currentConversations` are deliberately absent:
    // effect events are stable by construction, and listing them is an error.
    // `pushSubscription` is a dependency-free useCallback, so this effect runs
    // exactly once per mount.
  }, [pushSubscription]);

  const sendTyping = useCallback(
    (conversationId: string, isTyping: boolean) => {
      const live = socket.current;
      if (live?.readyState !== WebSocket.OPEN) return;
      live.send(
        JSON.stringify({
          type: "typing",
          conversation_id: conversationId,
          is_typing: isTyping,
        }),
      );
    },
    [],
  );

  const sendCallSignal = useCallback(
    (
      callId: string,
      signal: "offer" | "answer" | "ice" | "hangup",
      payload: unknown,
    ) => {
      const live = socket.current;
      if (live?.readyState !== WebSocket.OPEN) return;
      live.send(
        JSON.stringify({
          type: "call.signal",
          call_id: callId,
          signal,
          payload,
        }),
      );
    },
    [],
  );

  const setCallIds = useCallback(
    (ids: readonly string[]) => {
      wantedCalls.current = ids;
      pushSubscription();
    },
    [pushSubscription],
  );

  const setConversationIds = useCallback(
    (ids: readonly string[]) => {
      wanted.current = ids;
      pushSubscription();
    },
    [pushSubscription],
  );

  return {
    state,
    sendTyping,
    sendCallSignal,
    setCallIds,
    setConversationIds,
  };
}
