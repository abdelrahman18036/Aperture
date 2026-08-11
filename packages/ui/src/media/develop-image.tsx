"use client";

import { decode } from "blurhash";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { cn } from "../lib/cn";
import { AmbientGlow } from "./ambient-glow";

/**
 * The develop-in — the one signature motion in the product.
 *
 * A print does not appear, it comes up in the tray:
 *
 *     blurhash canvas (already loaded, instant)
 *       → 380ms: opacity 0→1 on the real image,
 *                filter: blur(12px) saturate(0.4) → blur(0) saturate(1)
 *       → cubic-bezier(0.16, 1, 0.3, 1)
 *
 * It runs **once per image, on first paint into the viewport, never on
 * re-render** — see the note on `developed` below for why that needs no latch
 * of its own. Under `prefers-reduced-motion` the blurhash cross-fades in
 * 120ms with no blur and no saturation change.
 *
 * No layout shift: the wrapper holds the aspect ratio from the `width` and
 * `height` already on the media row, so the space is reserved before either
 * the canvas or the image arrives.
 *
 * Deliberately a CSS transition rather than a Motion animation. The spec
 * describes two interpolated properties on one easing curve, which is exactly
 * what a transition is, and it keeps a feed of these off the animation frame
 * entirely.
 *
 * Deliberately a plain `<img>` rather than `next/image`, for three reasons
 * that all point the same way. The media worker has *already* produced the
 * renditions (`sources`), so Next's optimiser would be redoing work that is
 * done; routing them through it would put media bytes through our own server,
 * which `01-ARCHITECTURE.md` §6 rules out at every scale; and Next 16 refuses
 * to optimise a host that resolves to a private IP, which is what MinIO is in
 * development. The two things `next/image` would otherwise buy us — lazy
 * loading and no layout shift — this component already does itself.
 */

/** Blurhash decodes to a tiny bitmap and is scaled up by the canvas element. */
const BLURHASH_RESOLUTION = 32;

/** One rendition, straight from `media.sources`. */
export interface ImageSource {
  width: number;
  url: string;
}

interface DevelopImageProps {
  src: string;
  alt: string;
  /** The worker's renditions. Becomes the `srcset`; `src` is the fallback. */
  sources?: readonly ImageSource[];
  /** From the media row. Reserves the space, so nothing shifts on load. */
  width: number;
  height: number;
  /** `media.blurhash`. Without it the canvas simply stays empty. */
  blurhash?: string | null;
  /** `media.dominant_color`, drives the ambient glow behind the photo. */
  dominantColor?: string | null;
  /** Above the fold — skips lazy loading, still develops in. */
  priority?: boolean;
  sizes?: string;
  className?: string;
}

function DevelopImage({
  src,
  alt,
  sources,
  width,
  height,
  blurhash,
  dominantColor,
  priority = false,
  sizes = "(max-width: 640px) 100vw, 640px",
  className,
}: DevelopImageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(priority);

  const reduceMotion = useReducedMotion();

  // Paint the blurhash as soon as we have one. This is synchronous and cheap
  // at 32x32, so the placeholder is there on first paint rather than a frame
  // later.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !blurhash) return;

    let pixels: Uint8ClampedArray;
    try {
      pixels = decode(blurhash, BLURHASH_RESOLUTION, BLURHASH_RESOLUTION);
    } catch {
      // A malformed hash is not worth breaking a feed over. The canvas stays
      // empty and the image fades in over nothing.
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    const imageData = context.createImageData(
      BLURHASH_RESOLUTION,
      BLURHASH_RESOLUTION,
    );
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);
  }, [blurhash]);

  // "First paint into the viewport" — not first render.
  useEffect(() => {
    if (priority || inView) return;
    const frame = frameRef.current;
    if (!frame) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [priority, inView]);

  /**
   * Latched by construction rather than by a ref. Both inputs are monotonic —
   * an image does not un-load and the observer disconnects on first
   * intersection — so once this is true it stays true for the life of the
   * component, which is exactly "once per image, never on re-render".
   */
  const developed = loaded && inView;

  const onLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const duration = reduceMotion
    ? "var(--duration-reduced)"
    : "var(--duration-develop)";

  return (
    // Two wrappers on purpose. The glow has to escape the photo's bounds to
    // do its job, and the photo has to clip its own corners — one element
    // cannot both `overflow-hidden` and let a child bleed 60px past it.
    <div
      ref={frameRef}
      data-slot="develop-image"
      data-developed={developed || undefined}
      className={cn("relative isolate", className)}
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      <AmbientGlow color={dominantColor} />

      <div className="relative size-full overflow-hidden rounded-image">
        {blurhash ? (
          <canvas
            ref={canvasRef}
            width={BLURHASH_RESOLUTION}
            height={BLURHASH_RESOLUTION}
            aria-hidden="true"
            className="absolute inset-0 size-full"
          />
        ) : null}

        <img
          src={src}
          srcSet={
            sources && sources.length > 0
              ? sources.map((s) => `${s.url} ${String(s.width)}w`).join(", ")
              : undefined
          }
          sizes={sizes}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          onLoad={onLoad}
          className="absolute inset-0 size-full object-cover"
          style={{
            opacity: developed ? 1 : 0,
            // Reduced motion gets a plain cross-fade: no blur, no desaturation.
            filter: reduceMotion
              ? undefined
              : developed
                ? "blur(0px) saturate(1)"
                : "blur(12px) saturate(0.4)",
            transitionProperty: reduceMotion ? "opacity" : "opacity, filter",
            transitionDuration: duration,
            transitionTimingFunction: "var(--ease-develop)",
          }}
        />
      </div>
    </div>
  );
}

export { DevelopImage };
export type { DevelopImageProps };
