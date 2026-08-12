"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import {
  useRealtimeApi,
  useRealtimeEvents,
} from "@/features/realtime/provider";

import { ring, ringback } from "@/lib/sounds";

import { CallDock } from "./call-dock";
import { useCallSession, type CallSession } from "./use-call";
import { usePeerCall, type PeerCall } from "./use-peer-call";

/** How long to ring before giving up. About what a phone does. */
const RING_TIMEOUT_MS = 35_000;
import { useSfuCall, type SfuCall } from "./use-sfu-call";

/**
 * The call, wherever you happen to be.
 *
 * Calls used to live inside the conversation screen, which meant a call only
 * rang if you were already looking at the thread it came from — fine for a
 * demo and wrong for a phone. Hoisting it here is what makes ringing global,
 * and it is only possible because the socket was hoisted first: a call
 * listener at this level plus a socket down in the thread would be two
 * connections, which §9 rules out.
 *
 * The provider owns the session and both transports. The dock it renders is
 * the only call UI in the product, so there is exactly one place a call can
 * appear and exactly one thing to reason about when it does.
 */

interface CallControls {
  session: CallSession;
  peer: PeerCall;
  sfu: SfuCall;
  /** True while a call or an invite is on screen. */
  busy: boolean;
}

const CallContext = createContext<CallControls | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { viewerId, sendCallSignal } = useRealtimeApi();
  const session = useCallSession();

  const peerId = useMemo(
    () =>
      session.call?.participant_ids.find((id) => id !== viewerId) ?? null,
    [session.call, viewerId],
  );

  const peer = usePeerCall({
    call: session.call,
    // Before `connection.ready` lands there is no viewer id, and there is also
    // no call — the empty string never reaches a live negotiation.
    viewerId: viewerId ?? "",
    peerId,
    sendSignal: sendCallSignal,
    relayOnly: session.relayOnly,
    // While an invite is on screen we are already subscribed to the call's
    // channel — see `useCallSession` — so offers arrive before we have
    // joined. This is what lets them be kept rather than dropped.
    expectedCallId: session.call?.id ?? session.incoming?.call_id ?? null,
  });

  // Offers, answers and candidates arrive on the call's channel. The hook
  // ignores anything that is not a signal for the call it holds, so wiring it
  // straight to the socket is safe.
  useRealtimeEvents(peer.handleSignal);

  const sfu = useSfuCall(session.call);

  /**
   * Ring out after a while.
   *
   * Lives here because it needs both halves: the session holds the call, and
   * only `peer`/`sfu` know whether anything ever connected. 35 seconds is
   * about how long a phone rings before voicemail, which is the expectation
   * people already have.
   */
  const connected = peer.state === "connected" || sfu.connected;

  /**
   * A phone that does not ring is a missed call.
   *
   * Two sounds rather than one, because they say different things: the
   * incoming ring is asking you to act, and the ringback is telling you to
   * wait. Hearing the same tone for both is genuinely confusing when two tabs
   * of the same product are open side by side.
   *
   * Both stop through the effect's cleanup, so answering, declining, hanging
   * up, the ring timeout and a component unmount are all one code path. That
   * matters more than it looks: a ring that outlives the answer by half a
   * second is the sound of a broken app.
   */
  const incomingId = session.incoming?.call_id ?? null;
  useEffect(() => {
    if (incomingId === null) return;
    return ring();
  }, [incomingId]);

  const outgoingId = session.call?.id ?? null;
  useEffect(() => {
    if (outgoingId === null || connected) return;
    return ringback();
  }, [outgoingId, connected]);
  const { giveUp } = session;
  useEffect(() => {
    if (session.call === null || connected) return;
    const timer = window.setTimeout(() => {
      giveUp("No answer.");
    }, RING_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [session.call, connected, giveUp]);

  const value = useMemo<CallControls>(
    () => ({
      session,
      peer,
      sfu,
      busy: session.call !== null || session.incoming !== null,
    }),
    [session, peer, sfu],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallDock />
    </CallContext.Provider>
  );
}

export function useCallControls(): CallControls {
  const controls = useContext(CallContext);
  if (controls === null) {
    throw new Error("useCallControls must be used inside a CallProvider");
  }
  return controls;
}
