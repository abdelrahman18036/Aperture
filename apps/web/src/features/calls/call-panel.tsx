"use client";

import { PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button, cn } from "@repo/ui";

import type { CallPayload, PeerCall } from "./use-peer-call";
import type { SfuCall } from "./use-sfu-call";

/**
 * The call surface.
 *
 * **Daylight throughout, and no warm accent anywhere.** A call in progress is
 * the most literal case of "something happening now" the design system has —
 * `02-DESIGN-SYSTEM.md` puts in-call state explicitly on the cool side. The
 * one exception is hanging up, which is destructive and therefore the only
 * filled control on the screen.
 *
 * The video itself is the content, so it gets the same treatment a photograph
 * does: 2px radius, no card, no shadow, sitting on the base.
 */

function Video({
  stream,
  muted,
  label,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  className?: string;
}) {
  const element = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    node.srcObject = stream;
  }, [stream]);

  return (
    <div className={cn("relative min-w-0 bg-surface", className)}>
      <video
        ref={element}
        autoPlay
        playsInline
        // Your own preview is always muted. Playing it back is a feedback
        // loop, and it is the first thing anyone notices.
        muted={muted}
        className="size-full rounded-image object-cover"
      />
      <span className="absolute bottom-1 left-2 meta">{label}</span>
    </div>
  );
}

export function CallPanel({
  call,
  peer,
  sfu,
  peerName,
  onHangUp,
}: {
  call: CallPayload;
  peer: PeerCall;
  sfu: SfuCall;
  peerName: string;
  onHangUp: () => void;
}) {
  const group = call.mode === "sfu";
  const localStream = group ? sfu.localStream : peer.localStream;
  const error = group ? sfu.error : peer.error;
  const audioOnly = group ? sfu.audioOnly : peer.audioOnly;

  const status = group
    ? sfu.connected
      ? "Live"
      : "Connecting"
    : peer.state === "connected"
      ? "Live"
      : peer.state === "failed"
        ? "Failed"
        : "Connecting";

  return (
    <section
      aria-label={`Call with ${peerName}`}
      className="border-b border-line bg-base p-4"
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-title text-ink">{peerName}</h2>
        <span className="flex items-center gap-2 meta" aria-live="polite">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              status === "Live" ? "bg-daylight" : "bg-ink-faint",
            )}
          />
          {status}
          {/* The transport, stated rather than hidden. It is the difference
              between a call that works everywhere and one that works at home,
              and it costs one word to show. */}
          {peer.transport !== null && !group && (
            <span className="text-daylight">
              · {peer.transport === "relay" ? "Relayed" : "Direct"}
            </span>
          )}
          {call.mode === "sfu" && <span className="text-daylight">· SFU</span>}
          {/* Said plainly rather than left as a black rectangle. Someone
              wondering why they cannot be seen deserves the reason. */}
          {audioOnly && <span>· Audio only</span>}
        </span>
      </header>

      {error !== null && (
        <p className="mb-3 text-body text-danger" role="alert">
          {error}
        </p>
      )}

      <div
        className={cn(
          "grid gap-2",
          group ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2",
        )}
      >
        <Video
          stream={localStream}
          muted
          label="You"
          className="aspect-video"
        />
        {group ? (
          sfu.remotes.map((remote) => (
            <Video
              key={remote.identity}
              stream={remote.stream}
              label={remote.identity}
              className="aspect-video"
            />
          ))
        ) : (
          <Video
            stream={peer.remoteStream}
            label={peerName}
            className="aspect-video"
          />
        )}
      </div>

      <div className="mt-3 flex justify-center">
        <Button variant="destructive" onClick={onHangUp}>
          <PhoneOff className="size-4" aria-hidden="true" />
          Hang up
        </Button>
      </div>
    </section>
  );
}
