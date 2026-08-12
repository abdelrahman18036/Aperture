"use client";

import {
  ConnectionState,
  RoomEvent,
  Room,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { useEffect, useState } from "react";

import type { CallPayload } from "./use-peer-call";

/**
 * A group call, through the SFU.
 *
 * Above two people a mesh stops being the cheap option: every participant
 * would hold `n-1` encoders and `n-1` uplinks, so the fourth person costs the
 * other three more than they cost themselves. LiveKit takes one uplink from
 * each and fans it out.
 *
 * **The same client SDK talks to both.** Self-hosted LiveKit locally,
 * LiveKit Cloud in production — §4's design rule, and it is why moving is an
 * environment variable rather than a rewrite.
 *
 * There is no signalling here. LiveKit runs its own negotiation over its own
 * connection, so the socket's call events are a 1:1 concern only. What Django
 * supplies is the token, scoped to one room and one identity.
 */

export interface RemoteMedia {
  identity: string;
  stream: MediaStream;
}

export interface SfuCall {
  connected: boolean;
  localStream: MediaStream | null;
  remotes: RemoteMedia[];
  /** True when the camera could not be opened and the call went ahead anyway. */
  audioOnly: boolean;
  error: string | null;
}

export function useSfuCall(call: CallPayload | null): SfuCall {
  const [connected, setConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<RemoteMedia[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [withoutCamera, setWithoutCamera] = useState(false);

  const url = call?.livekit_url ?? null;
  const token = call?.livekit_token ?? null;

  /**
   * Only reachable if the server called something an SFU call and then
   * withheld the room. Derived rather than set from the effect: it is a fact
   * about the props, so computing it is both simpler and one less thing that
   * can be left stale.
   */
  const missingRoom =
    call !== null && call.mode === "sfu" && (url === null || token === null);

  useEffect(() => {
    if (call === null || call.mode !== "sfu") return;
    if (url === null || token === null) return;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    let cancelled = false;

    const attach = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ): void => {
      if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) {
        return;
      }
      setRemotes((current) => {
        const existing = current.find((r) => r.identity === participant.identity);
        if (existing !== undefined) {
          existing.stream.addTrack(track.mediaStreamTrack);
          return [...current];
        }
        return [
          ...current,
          {
            identity: participant.identity,
            stream: new MediaStream([track.mediaStreamTrack]),
          },
        ];
      });
    };

    const detach = (participant: RemoteParticipant): void => {
      setRemotes((current) =>
        current.filter((r) => r.identity !== participant.identity),
      );
    };

    room
      .on(RoomEvent.TrackSubscribed, attach)
      .on(RoomEvent.ParticipantDisconnected, detach)
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (cancelled) return;
        setConnected(state === ConnectionState.Connected);
      });

    void (async () => {
      try {
        await room.connect(url, token);
        if (cancelled) return;

        // Microphone first, and separately. `enableCameraAndMicrophone`
        // fails as a unit, so on a machine with no webcam it takes the
        // microphone down with it and there is no call at all — the same bug
        // the peer-to-peer path had. Audio is the call; video is an
        // enhancement.
        await room.localParticipant.setMicrophoneEnabled(true);
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          if (!cancelled) setWithoutCamera(true);
        }

        const tracks = room.localParticipant
          .getTrackPublications()
          .map((publication) => publication.track?.mediaStreamTrack)
          .filter((track): track is MediaStreamTrack => track !== undefined);
        setLocalStream(new MediaStream(tracks));
      } catch (cause) {
        if (cancelled) return;
        setJoinError(
          cause instanceof Error ? cause.message : "Could not join the call.",
        );
      }
    })();

    return () => {
      cancelled = true;
      void room.disconnect();
      setRemotes([]);
      setLocalStream(null);
      setConnected(false);
      setJoinError(null);
      setWithoutCamera(false);
    };
  }, [call, url, token]);

  const error = missingRoom ? "This call has no room to join." : joinError;

  return { connected, localStream, remotes, audioOnly: withoutCamera, error };
}
