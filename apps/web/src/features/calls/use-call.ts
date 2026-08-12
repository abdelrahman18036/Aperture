"use client";

import { useCallback, useState } from "react";

import type { AnyServerEvent, CallInvite } from "@repo/realtime-events";

import { api } from "@/lib/api";

import type { CallPayload } from "./use-peer-call";

/**
 * Call lifecycle, on top of the socket a conversation already holds.
 *
 * §9 says not to open a second connection, and the reason is not tidiness:
 * a second socket means a second ticket, a second reconnect path, and two
 * places for presence to disagree. Calls ride the one that already exists.
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
  start: () => void;
  answer: () => void;
  decline: () => void;
  hangUp: () => void;
  /** Feed socket traffic in. Returns true if the event was a call event. */
  observe: (event: AnyServerEvent) => boolean;
}

interface Options {
  conversationId: string;
  /** Send one signalling frame. Owned by the conversation's socket. */
  sendSignal: (
    callId: string,
    signal: "offer" | "answer" | "ice" | "hangup",
    payload: unknown,
  ) => void;
}

export function useCall({ conversationId, sendSignal }: Options): CallSession {
  const [call, setCall] = useState<CallPayload | null>(null);
  const [incoming, setIncoming] = useState<CallInvite | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setStarting(true);
    setError(null);

    void api
      .POST("/api/calls/start", { body: { conversation_id: conversationId } })
      .then((response) => {
        setStarting(false);
        if (response.data === undefined) {
          setError("The call could not be placed.");
          return;
        }
        setCall(response.data);
      });
  }, [conversationId]);

  const answer = useCallback(() => {
    if (incoming === null) return;
    const invite = incoming;
    setIncoming(null);
    setStarting(true);

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
    // declined call that fails to say so simply times out at the other end,
    // which is the same thing a dropped network does.
    sendSignal(incoming.call_id, "hangup", { reason: "declined" });
    setIncoming(null);
  }, [incoming, sendSignal]);

  const hangUp = useCallback(() => {
    if (call !== null) sendSignal(call.id, "hangup", { reason: "ended" });
    setCall(null);
  }, [call, sendSignal]);

  const observe = useCallback(
    (event: AnyServerEvent): boolean => {
      if (event.type === "call.incoming") {
        // Only ring for the thread on screen. A global incoming-call surface
        // is a real feature and a bigger one than this phase — see the
        // handoff.
        if (event.conversation_id !== conversationId) return true;
        setIncoming(event);
        return true;
      }

      if (event.type === "call.signal") {
        if (event.signal === "hangup" && call !== null) {
          if (event.call_id === call.id) setCall(null);
        }
        return true;
      }

      return false;
    },
    [call, conversationId],
  );

  return {
    call,
    incoming,
    starting,
    error,
    start,
    answer,
    decline,
    hangUp,
    observe,
  };
}
