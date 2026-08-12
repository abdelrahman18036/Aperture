"use client";

import { createContext, useContext, useMemo } from "react";

import {
  useRealtimeApi,
  useRealtimeEvents,
} from "@/features/realtime/provider";

import { CallDock } from "./call-dock";
import { useCallSession, type CallSession } from "./use-call";
import { usePeerCall, type PeerCall } from "./use-peer-call";
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
  });

  // Offers, answers and candidates arrive on the call's channel. The hook
  // ignores anything that is not a signal for the call it holds, so wiring it
  // straight to the socket is safe.
  useRealtimeEvents(peer.handleSignal);

  const sfu = useSfuCall(session.call);

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
