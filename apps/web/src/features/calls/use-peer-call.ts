"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import type { AnyServerEvent, CallSignalEvent } from "@repo/realtime-events";

import { MediaUnavailableError, openLocalMedia } from "./local-media";

export type CallPayload = Schemas["Call"];

/**
 * A 1:1 call, peer to peer.
 *
 * Two people is the case where a mesh *is* the whole call, so there is no SFU
 * in this path — media goes browser to browser, with TURN relaying only when
 * the network refuses a direct connection.
 *
 * **Perfect negotiation.** Both sides can start talking at once, and the
 * naive fix — whoever called goes first — breaks as soon as anything
 * renegotiates mid-call. The pattern instead gives one side the *polite*
 * role: on a collision the polite peer rolls back its own offer and accepts
 * the other's, while the impolite peer ignores the incoming one. The role
 * comes from comparing user ids, so both sides derive the same answer with no
 * extra round trip.
 *
 * **Trickle ICE.** Candidates go out as they are found rather than after
 * gathering completes. Waiting costs seconds of silence at the start of every
 * call, and more on a relayed one.
 */

export type CallState =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "ended";

export interface PeerCall {
  state: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Which kind of candidate pair the connection settled on. */
  transport: "direct" | "relay" | null;
  /** True when there was no camera and the call went ahead on audio. */
  audioOnly: boolean;
  error: string | null;
  /**
   * Feed socket traffic in. Anything that is not a call signal for this call
   * is ignored, so it is safe to wire straight to the socket.
   */
  handleSignal: (event: AnyServerEvent) => void;
}

interface Options {
  call: CallPayload | null;
  /** Us. Decides the polite role and filters our own echoed signals. */
  viewerId: string;
  /** The other party. */
  peerId: string | null;
  /**
   * The call we may receive signalling for, which is **not** the same as the
   * call we are in.
   *
   * A callee holds an invite for several seconds before answering, and the
   * caller starts offering the moment its own tracks are added. Without this,
   * `call` is still null on the callee's side and those offers are dropped
   * rather than queued — and dropping the first offer is what turns a call
   * into a spinner. See the deadlock described on `handleSignal`.
   */
  expectedCallId?: string | null;
  sendSignal: (
    callId: string,
    signal: "offer" | "answer" | "ice" | "hangup",
    payload: unknown,
  ) => void;
  /**
   * Force every candidate through the relay.
   *
   * This phase's verification: with `relay`, a call that still connects
   * proves the TCP/443 path works — the one that matters, because it is what
   * survives a network dropping UDP.
   */
  relayOnly?: boolean;
}

export function usePeerCall({
  call,
  viewerId,
  peerId,
  sendSignal,
  relayOnly = false,
  expectedCallId = null,
}: Options): PeerCall {
  /**
   * The connection's own state, and nothing invented on top of it.
   *
   * Written only from callbacks — never synchronously inside the effect that
   * builds the connection. The displayed `state` below is derived from it,
   * which is both what the React Compiler wants and simply truer: there is no
   * second source of truth to drift.
   */
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState | null>(null);
  const [hungUp, setHungUp] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [transport, setTransport] = useState<"direct" | "relay" | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = useRef<RTCPeerConnection | null>(null);
  const makingOffer = useRef(false);
  /** Frames that arrived before the connection existed. */
  const queued = useRef<CallSignalEvent[]>([]);

  /**
   * The polite peer yields on a collision.
   *
   * Comparing ids is arbitrary but *stable*, and needs no negotiation of its
   * own — both sides compute the same answer from what they already know.
   */
  const polite = peerId !== null && viewerId < peerId;

  /** Which pair ICE actually chose. This is the verification, read live. */
  const readTransport = useCallback(async () => {
    const peer = connection.current;
    if (peer === null) return;

    const stats = await peer.getStats();

    let selectedPairId: string | undefined;
    for (const report of stats.values()) {
      if (report.type === "transport") {
        selectedPairId = (report as { selectedCandidatePairId?: string })
          .selectedCandidatePairId;
      }
    }

    for (const report of stats.values()) {
      const pair = report as RTCIceCandidatePairStats & {
        localCandidateId?: string;
        selected?: boolean;
      };
      if (pair.type !== "candidate-pair") continue;

      const isSelected =
        pair.id === selectedPairId ||
        pair.selected === true ||
        (selectedPairId === undefined && pair.state === "succeeded");
      if (!isSelected || pair.localCandidateId === undefined) continue;

      const local = stats.get(pair.localCandidateId) as
        | { candidateType?: string }
        | undefined;
      setTransport(local?.candidateType === "relay" ? "relay" : "direct");
      return;
    }
  }, []);

  const applySignal = useCallback(
    async (event: CallSignalEvent): Promise<void> => {
      const peer = connection.current;
      if (peer === null || call === null) return;

      if (event.signal === "offer" || event.signal === "answer") {
        const description = event.payload as RTCSessionDescriptionInit;

        const collision =
          description.type === "offer" &&
          (makingOffer.current || peer.signalingState !== "stable");

        if (collision && !polite) {
          // Impolite: keep our offer, drop theirs. The polite side is rolling
          // back right now, so exactly one negotiation survives.
          return;
        }

        await peer.setRemoteDescription(description);
        if (description.type === "offer") {
          await peer.setLocalDescription();
          if (peer.localDescription !== null) {
            sendSignal(call.id, "answer", peer.localDescription.toJSON());
          }
        }
        return;
      }

      if (event.signal === "ice") {
        try {
          await peer.addIceCandidate(event.payload as RTCIceCandidateInit);
        } catch {
          // A candidate belonging to an offer we ignored has nothing to
          // attach to. Dropping it is correct — the surviving negotiation
          // brings its own.
        }
        return;
      }

      if (event.signal === "hangup") {
        setHungUp(true);
      }
    },
    [call, polite, sendSignal],
  );

  /**
   * Anything for this call, whether or not we have joined it yet.
   *
   * **The deadlock this closes.** The caller adds tracks immediately, which
   * fires `negotiationneeded` and sends an offer — while the callee is still
   * deciding whether to answer. That offer used to be dropped, because the
   * callee's `call` was null until the join returned. The caller was then
   * parked in `have-local-offer` with an offer nobody had received.
   *
   * When the callee finally added its own tracks and offered, the caller saw a
   * collision (its signalling state was not `stable`) and — if it happened to
   * be the *impolite* peer — ignored it, per perfect negotiation. Neither side
   * ever answered the other. Both sat on "Connecting" until the ring timeout,
   * and which side was impolite came down to a string comparison of two user
   * ids, so it failed for one ordering and worked for the other.
   */
  const handleSignal = useCallback(
    (event: AnyServerEvent) => {
      if (event.type !== "call.signal") return;
      // Everyone on the channel receives their own frames back, including us.
      if (event.from === viewerId) return;

      const mine = call?.id ?? expectedCallId;
      if (mine === null || mine === undefined) return;
      if (event.call_id !== mine) return;

      if (connection.current === null) {
        // Queued rather than dropped: an offer can arrive before we answered,
        // and before `getUserMedia` has finished. Losing the first offer costs
        // the whole call.
        queued.current.push(event);
        return;
      }
      void applySignal(event);
    },
    [applySignal, call, expectedCallId, viewerId],
  );

  useEffect(() => {
    if (call === null || call.mode !== "p2p" || peerId === null) return;

    let cancelled = false;
    const callId = call.id;

    const peer = new RTCPeerConnection({
      // Handed over by Django with a credential that expires. Passed through
      // untouched: the browser knows what an `RTCIceServer` is, and reshaping
      // it here would only be a chance to get it wrong.
      iceServers: call.ice_servers as RTCIceServer[],
      iceTransportPolicy: relayOnly ? "relay" : "all",
    });
    connection.current = peer;

    peer.onicecandidate = ({ candidate }) => {
      // The null candidate marks end-of-gathering, and there is nothing to
      // send for it.
      if (candidate === null) return;
      sendSignal(callId, "ice", candidate.toJSON());
    };

    peer.ontrack = ({ streams }) => {
      setRemoteStream(streams[0] ?? null);
    };

    peer.onconnectionstatechange = () => {
      if (cancelled) return;
      setConnectionState(peer.connectionState);
      if (peer.connectionState === "connected") {
        void readTransport();
      } else if (peer.connectionState === "failed") {
        // Genuinely failed: ICE exhausted every pair, relay included.
        // "disconnected" is a different thing and recovers on its own.
        setError("The connection could not be established.");
      }
    };

    peer.onnegotiationneeded = () => {
      void (async () => {
        try {
          makingOffer.current = true;
          await peer.setLocalDescription();
          if (peer.localDescription !== null) {
            sendSignal(callId, "offer", peer.localDescription.toJSON());
          }
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Negotiation failed.",
          );
        } finally {
          makingOffer.current = false;
        }
      })();
    };

    void (async () => {
      try {
        // Audio is the call; video is an enhancement. A machine with no
        // webcam still gets a call — see `local-media.ts`.
        const { stream, audioOnly: withoutVideo } = await openLocalMedia();
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        setLocalStream(stream);
        setAudioOnly(withoutVideo);

        // **Before** adding our tracks, and awaited in order.
        //
        // Adding tracks fires `negotiationneeded`, which sends an offer. If a
        // remote offer is sitting in the queue, answering it first means this
        // side moves to `have-remote-offer` and replies — one negotiation,
        // resolved. Doing it the other way round manufactures the collision
        // that politeness then has to unpick, and the frames were fired
        // unawaited so their order was not even guaranteed.
        const pending = queued.current;
        queued.current = [];
        for (const event of pending) {
          if (cancelled) return;
          await applySignal(event);
        }
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        for (const track of stream.getTracks()) peer.addTrack(track, stream);
      } catch (cause) {
        setError(
          cause instanceof MediaUnavailableError
            ? cause.message
            : "The microphone could not be opened.",
        );
      }
    })();

    return () => {
      cancelled = true;
      peer.close();
      connection.current = null;
      queued.current = [];

      // Stop the camera here rather than in a separate effect. This cleanup
      // runs when the call ends as well as on unmount, and a camera light
      // still on after a call has ended is the kind of bug people remember.
      setLocalStream((current) => {
        if (current !== null) {
          for (const track of current.getTracks()) track.stop();
        }
        return null;
      });
      setRemoteStream(null);
      setConnectionState(null);
      setTransport(null);
      setAudioOnly(false);
      setError(null);
      setHungUp(false);
    };
  }, [call, peerId, relayOnly, sendSignal, readTransport, applySignal]);

  // Nothing to hold once there is no call to hold it for. Without this a
  // declined invite leaves its offers in the queue, and the next call
  // built on this component would apply them.
  useEffect(() => {
    if (call === null && expectedCallId === null) queued.current = [];
  }, [call, expectedCallId]);

  const state: CallState =
    call === null
      ? "idle"
      : hungUp
        ? "ended"
        : connectionState === "connected"
          ? "connected"
          : connectionState === "failed" || connectionState === "closed"
            ? "failed"
            : "connecting";

  return {
    state,
    localStream,
    remoteStream,
    transport,
    audioOnly,
    error,
    handleSignal,
  };
}
