"use client";

import { useCallback, useEffect, useState } from "react";

import type { AnyServerEvent, CallInvite } from "@repo/realtime-events";

import { useRealtimeApi, useRealtimeEvents } from "@/features/realtime/provider";
import { api } from "@/lib/api";

import type { CallPayload } from "./use-peer-call";

/**
 * `?relay=1` forces every candidate through TURN.
 *
 * Phase 7's verification asks for exactly this, and keeping it in the product
 * rather than a throwaway script keeps the check runnable. Read from the URL
 * at the moment a call starts: harmless, since it only *restricts* which
 * candidates are tried, so the most it can do is route your own call the slow
 * way — which on a hostile network is sometimes the point.
 */
function readRelayFlag(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("relay") === "1";
}

/**
 * Call lifecycle, on the application's one socket.
 *
 * §9 says not to open a second connection, and once calls had to ring
 * anywhere rather than only inside an open thread that became load-bearing:
 * a global listener plus a per-thread socket is two sockets. Both now share
 * the one in `features/realtime`.
 *
 * The split of responsibilities is the interesting part and it is deliberate:
 *
 * - **Starting and answering go over HTTP**, because both are authorization
 *   decisions and the gateway has no database (rule 6).
 * - **Everything after stays on the socket**, because an offer that outlived
 *   the call it belonged to would be worse than useless (§8).
 */

export interface CallSession {
  /** The call we are in, or null. */
  call: CallPayload | null;
  /** Somebody is ringing us and we have not answered. */
  incoming: CallInvite | null;
  starting: boolean;
  error: string | null;
  /** Who is on the other end, for the dock's header. */
  label: string | null;
  /**
   * Whether this call was placed with every candidate forced through TURN.
   *
   * Captured when the call starts rather than read from a hook, so the shell
   * does not need `useSearchParams` — which would drag a Suspense boundary
   * around every static route for the sake of a debugging flag.
   */
  relayOnly: boolean;
  /** Ring a conversation. */
  start: (conversationId: string, label: string) => void;
  answer: () => void;
  decline: () => void;
  hangUp: () => void;
  /** Stop ringing and say why. The provider's ring timeout calls this. */
  giveUp: (reason: string) => void;
  /** Dismiss a failure without ending anything. */
  clearError: () => void;
}

export function useCallSession(): CallSession {
  const [call, setCall] = useState<CallPayload | null>(null);
  const [incoming, setIncoming] = useState<CallInvite | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [relayOnly, setRelayOnly] = useState(false);

  const { sendCallSignal, setCallIds } = useRealtimeApi();

  const start = useCallback(
    (conversationId: string, who: string) => {
      setStarting(true);
      setError(null);
      setLabel(who);
      setRelayOnly(readRelayFlag());

      void api
        .POST("/api/calls/start", { body: { conversation_id: conversationId } })
        .then((response) => {
          setStarting(false);
          if (response.data === undefined) {
            // The server's reason, when it gave one. "Nobody in this
            // conversation is online to take a call" tells somebody what to
            // do next; "the call could not be placed" tells them nothing and
            // is the same sentence whether the callee is away, the account
            // is blocked, or the rate limit bit.
            const detail = (
              response.error as { detail?: string } | undefined
            )?.detail;
            setError(detail ?? "The call could not be placed.");
            return;
          }
          setCall(response.data);
        });
    },
    [],
  );

  const answer = useCallback(() => {
    if (incoming === null) return;
    const invite = incoming;
    setIncoming(null);
    setStarting(true);
    setLabel(invite.caller.username);
    setRelayOnly(readRelayFlag());

    void api
      .POST("/api/calls/join", {
        body: {
          conversation_id: invite.conversation_id,
          call_id: invite.call_id,
          mode: invite.mode,
        },
      })
      .then((response) => {
        setStarting(false);
        if (response.data === undefined) {
          setError("The call could not be joined.");
          return;
        }
        setCall(response.data);
      });
  }, [incoming]);

  const decline = useCallback(() => {
    if (incoming === null) return;
    // Tell the caller rather than leaving them ringing out. Best effort: a
    // decline that fails to send simply times out at the other end, which is
    // what a dropped network does anyway.
    sendCallSignal(incoming.call_id, "hangup", { reason: "declined" });
    setIncoming(null);
  }, [incoming, sendCallSignal]);

  const hangUp = useCallback(() => {
    if (call !== null) sendCallSignal(call.id, "hangup", { reason: "ended" });
    setCall(null);
    setLabel(null);
  }, [call, sendCallSignal]);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Stop ringing, with a reason.
   *
   * **This is what actually fixes "it just says Connecting forever".** An
   * invite is published to a Redis channel; if nobody is subscribed — the
   * callee is closed, asleep, or on a dead network — there is no failure
   * anywhere to observe. Nothing errors and nothing times out, so the caller
   * watches a spinner until they give up.
   *
   * Presence is not the answer to this on its own. It is a hint that can be
   * briefly wrong, and refusing a call on it would mean a Redis hiccup blocks
   * every call in the product — a hint must not become a gate. Ringing out is
   * the honest mechanism: true whatever presence says, and what a telephone
   * does. The provider owns the clock, because only it can see whether the
   * connection came up.
   */
  const giveUp = useCallback(
    (reason: string) => {
      if (call !== null) {
        sendCallSignal(call.id, "hangup", { reason: "no-answer" });
      }
      setCall(null);
      setLabel(null);
      setError(reason);
    },
    [call, sendCallSignal],
  );

  const onEvent = useCallback(
    (event: AnyServerEvent) => {
      if (event.type === "call.incoming") {
        // No conversation filter: this is the whole point of hoisting the
        // socket. A call rings while you are reading the feed, or a different
        // thread, or nothing at all.
        setIncoming((current) => {
          // Already in a call, or already ringing for another. Answering two
          // at once is not a state this product has, and silently replacing
          // the first invite would lose whoever rang first.
          if (current !== null) return current;
          return event;
        });
        return;
      }

      if (event.type === "call.signal" && event.signal === "hangup") {
        setIncoming((current) =>
          current !== null && current.call_id === event.call_id ? null : current,
        );
        setCall((current) =>
          current !== null && current.id === event.call_id ? null : current,
        );
      }
    },
    [],
  );

  useRealtimeEvents(onEvent);

  // Subscribing to the call's channel is what makes signalling reach us, and
  // it must happen before the first offer does. Driven by the call's
  // *existence* rather than its state, and by the invite as well as the call
  // itself — a callee has to be listening while they decide whether to answer.
  const activeCallId = call?.id ?? incoming?.call_id ?? null;
  useEffect(() => {
    setCallIds(activeCallId === null ? [] : [activeCallId]);
  }, [activeCallId, setCallIds]);

  return {
    call,
    incoming,
    starting,
    error,
    label,
    relayOnly,
    start,
    answer,
    decline,
    hangUp,
    giveUp,
    clearError,
  };
}
