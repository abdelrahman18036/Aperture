"use client";

import { decode } from "blurhash";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
 * **The controls are ours, not the browser's.** `<video controls>` renders a
 * different chrome on every platform — a fat grey Chrome bar, a translucent
 * Safari one, neither with any relationship to a dark room. On a page whose
 * entire argument is that a photograph sits on the base with no container,
 * a stock control bar is the one element that looks pasted on.
 *
 * So: a hairline scrubber, safelight for the part that has played, icons at
 * 16px, timecodes in `meta`. The accent stays inside the design system's cap
 * of "rings, icon fills, 1px underlines" — a 3px progress bar is the biggest
 * warm thing here, and it is warm because scrubbing is something *you* do.
 *
 * Everything the native controls gave away for free is rebuilt rather than
 * dropped: space and K toggle, arrows seek, M mutes, F is fullscreen, the
 * scrubber is a real `range` so a keyboard and a screen reader both reach it.
 */

/** Blurhash decodes to a tiny bitmap and is scaled up by the canvas element. */
const BLURHASH_RESOLUTION = 32;

/** How long the controls linger after the pointer stops moving. */
const IDLE_MS = 2200;

/** Arrow-key seek distance, in seconds. */
const SEEK_STEP = 5;

/** Shared by both fullscreen snapshots; `fullscreenEnabled` never changes. */
function subscribeToFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
  };
}

export interface DevelopVideoProps {
  src: string;
  /** From the media row. Reserves the space, so nothing shifts on load. */
  width: number;
  height: number;
  /** `media.blurhash`. Becomes the poster; without it the frame stays dark. */
  blurhash?: string | null;
  /** `media.duration_ms`, shown before playback starts. */
  durationMs?: number | null;
  /** Describes the video for anyone who cannot see it. */
  label?: string;
  /**
   * A smaller surface — a message attachment rather than a feed post. Drops
   * the timecodes and fullscreen, which do not fit at 256px and are not what
   * anybody wants from a clip in a thread.
   */
  compact?: boolean;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${String(minutes)}:${String(whole % 60).padStart(2, "0")}`;
}

export function DevelopVideo({
  src,
  width,
  height,
  blurhash,
  durationMs,
  label,
  compact = false,
  className,
}: DevelopVideoProps): React.JSX.Element {
  const frame = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const idleTimer = useRef<number | null>(null);

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [buffered, setBuffered] = useState(0);
  const [idle, setIdle] = useState(false);
  const [hovering, setHovering] = useState(false);
  /**
   * Fullscreen state, read from the document rather than mirrored into it.
   *
   * `useSyncExternalStore` instead of an effect: the browser owns both of
   * these facts, and copying them into state means a `setState` in an effect
   * body — which the compiler rejects, correctly, as a cascading render.
   * The server snapshot is `false` on both, so nothing mismatches on
   * hydration.
   *
   * `fullscreenEnabled` is false when a Permissions-Policy forbids it: an
   * embedded webview, an `<iframe>` without `allow="fullscreen"`. The request
   * then rejects with "Permissions check failed", and before this the button
   * did nothing and said nothing. A control that cannot work should not be
   * offered — the same rule that took the report button off your own posts.
   */
  const fullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  const canFullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => document.fullscreenEnabled,
    () => false,
  );

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

  /** Any interaction wakes the controls and restarts the idle countdown. */
  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setIdle(true);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void frame.current?.requestFullscreen().catch(() => {
      // iOS Safari has no element fullscreen and only ever fullscreens the
      // video itself, through its own prefixed method. Trying it here means
      // the button works there too rather than being hidden.
      const node = video.current as
        | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
        | null;
      node?.webkitEnterFullscreen?.();
    });
  }, []);

  const toggle = useCallback(() => {
    const node = video.current;
    if (node === null) return;
    setStarted(true);
    wake();
    // Playing must happen in the event's own task or the browser treats it
    // as programmatic and blocks it.
    if (node.paused) {
      // Caught, not `void`ed. `play()` rejects for reasons that are entirely
      // normal — an autoplay policy, or the browser pausing background media
      // to save power — and an uncaught rejection turns each of those into a
      // reported error. `onPause` has already put the UI back either way.
      node.play().catch(() => undefined);
    } else {
      node.pause();
    }
  }, [wake]);

  const seekBy = useCallback(
    (delta: number) => {
      const node = video.current;
      if (node === null) return;
      node.currentTime = Math.min(
        Math.max(node.currentTime + delta, 0),
        node.duration || 0,
      );
      wake();
    },
    [wake],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // The scrubber is a range input and owns the arrow keys itself; the
      // rest are the shortcuts every player has.
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      } else if (event.key.toLowerCase() === "m") {
        const node = video.current;
        if (node !== null) {
          node.muted = !node.muted;
          setMuted(node.muted);
        }
      } else if (event.key.toLowerCase() === "f" && !compact && canFullscreen) {
        toggleFullscreen();
      } else if (event.key === "ArrowRight") {
        seekBy(SEEK_STEP);
      } else if (event.key === "ArrowLeft") {
        seekBy(-SEEK_STEP);
      }
    },
    [toggle, seekBy, compact, canFullscreen, toggleFullscreen],
  );

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  /**
   * Controls stay while paused — a paused video with hidden controls is a
   * still image with no way to restart it — and while the pointer is inside
   * the player.
   *
   * `hovering` is tracked separately from the idle timer because of a bug
   * this had: the bar is `pointer-events-none` while faded, so a click on a
   * control that *looks* present passes straight through to the video and
   * toggles playback instead. Reaching for Fullscreen and getting a pause is
   * exactly the "nothing happens" that was reported. Revealing on
   * `pointerenter` rather than only on `pointermove` means the bar is live
   * by the time a pointer arrives at it.
   */
  const showControls = started && (!playing || hovering || !idle);

  return (
    <div
      ref={frame}
      onPointerEnter={() => {
        setHovering(true);
        wake();
      }}
      onPointerMove={wake}
      onPointerLeave={() => {
        setHovering(false);
        if (playing) setIdle(true);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative overflow-hidden rounded-image bg-surface",
        className,
      )}
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      <video
        ref={video}
        src={src}
        // `none` until asked: a feed of videos that each preload metadata is
        // a page that costs a great deal before anyone watches anything.
        preload={started ? "auto" : "none"}
        playsInline
        muted={muted}
        loop
        aria-label={label}
        onClick={toggle}
        onPlay={() => {
          // `started` is set here rather than only in `toggle`, because
          // `onPlay` is the authoritative signal that playback began — and
          // it can begin by routes the toggle knows nothing about. Setting
          // it only in the click handler left the poster canvas covering a
          // playing video, with the controls still hidden behind it.
          setStarted(true);
          setPlaying(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setIdle(false);
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => {
          setCurrent(event.currentTarget.currentTime);
          const ranges = event.currentTarget.buffered;
          if (ranges.length > 0) setBuffered(ranges.end(ranges.length - 1));
        }}
        className="size-full cursor-pointer object-cover"
      />

      {/* The poster, until the first play. Removed after that rather than
          hidden, so a paused video shows its own frame and not a blur. */}
      {!started && (
        <>
          <canvas
            ref={canvasRef}
            width={BLURHASH_RESOLUTION}
            height={BLURHASH_RESOLUTION}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
          />
          {typeof durationMs === "number" && durationMs > 0 && (
            <span className="pointer-events-none absolute bottom-2 right-2 meta text-ink">
              {formatTime(durationMs / 1000)}
            </span>
          )}
        </>
      )}

      {/* The one round filled thing in the product. A play control that is
          not obviously a play control is a broken video. */}
      {(!started || !playing) && (
        <button
          type="button"
          onClick={toggle}
          aria-label={
            started
              ? `Play${label ? `: ${label}` : ""}`
              : `Play${label ? `: ${label}` : ""}`
          }
          className="absolute inset-0 grid place-items-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-base/70 ring-1 ring-line backdrop-blur-sm transition-transform duration-[var(--duration-hover)] group-hover:scale-105">
            <Play className="size-6 translate-x-0.5 text-ink" aria-hidden="true" />
          </span>
        </button>
      )}

      {/* The control bar. A wash rather than a solid strip, so the last
          inches of the picture are still the picture. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-1 px-3 pb-2 pt-8",
          "bg-gradient-to-t from-base/85 via-base/40 to-transparent",
          "transition-opacity duration-[var(--duration-hover)]",
          showControls
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
      >
        <div className="relative flex items-center">
          {/* Buffered, behind the scrubber. Nothing to interact with — it is
              the answer to "will it stall if I jump there". */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 h-[3px] rounded-full bg-line"
          >
            <span
              className="block h-full rounded-full bg-ink-faint/50"
              style={{ width: `${String(bufferedPercent)}%` }}
            />
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-[3px] rounded-full bg-safelight"
            style={{ width: `${String(progress)}%` }}
          />

          {/* A real range input, so arrows, Home/End and a screen reader all
              work without any of it being reimplemented. Its own visuals are
              stripped; the two spans above are what you see. */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            aria-label="Seek"
            onChange={(event) => {
              const node = video.current;
              if (node === null) return;
              node.currentTime = Number(event.target.value);
              setCurrent(node.currentTime);
              wake();
            }}
            className={cn(
              "relative z-10 h-3 w-full cursor-pointer appearance-none bg-transparent",
              "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-safelight",
              "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full",
              "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-safelight",
            )}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="text-ink-dim hover:text-ink"
          >
            {playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>

          {!compact && (
            <span className="meta tabular-nums text-ink-dim">
              {formatTime(current)} / {formatTime(duration)}
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              const node = video.current;
              if (node === null) return;
              node.muted = !node.muted;
              setMuted(node.muted);
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            className="ml-auto text-ink-dim hover:text-ink"
          >
            {muted ? (
              <VolumeX className="size-4" aria-hidden="true" />
            ) : (
              <Volume2 className="size-4" aria-hidden="true" />
            )}
          </button>

          {/* Absent, not disabled, where the platform forbids it. A greyed
              control still invites a click and still answers with nothing. */}
          {!compact && canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="text-ink-dim hover:text-ink"
            >
              {fullscreen ? (
                <Minimize2 className="size-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
