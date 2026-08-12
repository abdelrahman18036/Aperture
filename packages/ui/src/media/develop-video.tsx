"use client";

import { decode } from "blurhash";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/cn";

/**
 * A video, held to the same rules as a photograph.
 *
 * **It does not autoplay, and that is a design decision rather than an
 * oversight.** `02-DESIGN-SYSTEM.md` is explicit that a feed "is for
 * consuming, not for being performed at" and rules out scroll-triggered
 * behaviour; video that starts itself as you scroll past is the loudest
 * possible version of exactly that. It also spends someone's data without
 * asking, which is a real cost on the networks §9 is written around.
 *
 * So the first frame is the blurhash the worker already computed — the same
 * still the photographs use — and playing is a decision. Once playing it is
 * a plain `<video controls>`, because a hand-rolled scrubber is a worse
 * scrubber and the browser's already works with a keyboard.
 *
 * Sound starts off. Unmuted autoplay is blocked by browsers anyway, and a
 * feed that makes noise is a feed people close.
 */

/** Blurhash decodes to a tiny bitmap and is scaled up by the canvas element. */
const BLURHASH_RESOLUTION = 32;

export interface DevelopVideoProps {
  src: string;
  /** From the media row. Reserves the space, so nothing shifts on load. */
  width: number;
  height: number;
  /** `media.blurhash`. Becomes the poster; without it the frame stays dark. */
  blurhash?: string | null;
  /** `media.duration_ms`, shown in the corner in `meta` type. */
  durationMs?: number | null;
  /** Describes the video for anyone who cannot see it. */
  label?: string;
  className?: string;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

export function DevelopVideo({
  src,
  width,
  height,
  blurhash,
  durationMs,
  label,
  className,
}: DevelopVideoProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Paint the blurhash immediately. Same approach as `DevelopImage`: it is
  // synchronous, cheap, and means the space is never empty.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !blurhash) return;

    let pixels: Uint8ClampedArray;
    try {
      pixels = decode(blurhash, BLURHASH_RESOLUTION, BLURHASH_RESOLUTION);
    } catch {
      // A malformed hash is not worth breaking a feed over.
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(
      BLURHASH_RESOLUTION,
      BLURHASH_RESOLUTION,
    );
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
  }, [blurhash]);

  function start(): void {
    setPlaying(true);
    // Playing must happen in the click's own task or the browser treats it as
    // programmatic and blocks it.
    void videoRef.current?.play();
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-image bg-surface", className)}
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      <video
        ref={videoRef}
        src={src}
        // `none` until asked: a feed of videos that each preload metadata is a
        // page that costs a great deal before anyone watches anything.
        preload={playing ? "auto" : "none"}
        controls={playing}
        playsInline
        muted
        loop
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="size-full object-cover"
      />

      {!playing && (
        <>
          <canvas
            ref={canvasRef}
            width={BLURHASH_RESOLUTION}
            height={BLURHASH_RESOLUTION}
            aria-hidden="true"
            className="absolute inset-0 size-full"
          />
          <button
            type="button"
            onClick={start}
            aria-label={label ? `Play: ${label}` : "Play video"}
            className={cn(
              "absolute inset-0 grid place-items-center",
              // The only round, filled thing in the product. A play control
              // that is not obviously a play control is a broken video.
              "transition-opacity duration-[var(--duration-hover)]",
            )}
          >
            <span className="grid size-14 place-items-center rounded-full bg-base/70 ring-1 ring-line">
              <Play className="size-6 translate-x-0.5 text-ink" aria-hidden="true" />
            </span>
          </button>
          {typeof durationMs === "number" && durationMs > 0 && (
            <span className="pointer-events-none absolute bottom-2 right-2 meta text-ink">
              {formatDuration(durationMs)}
            </span>
          )}
        </>
      )}
    </div>
  );
}
