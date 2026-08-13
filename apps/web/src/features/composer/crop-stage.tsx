"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@repo/ui";

/**
 * Crop.
 *
 * Built rather than installed. A cropper is a rectangle, a transform and a
 * `drawImage` call; the libraries bring their own handles, shadows and easing,
 * and every one of those is a decision `02-DESIGN-SYSTEM.md` has already made.
 *
 * The crop is held in **image pixels**, not screen pixels: a centre point and
 * a zoom. That keeps it independent of how big the stage happens to be
 * rendered, so exporting needs no DOM measurement and a resized window does
 * not move the crop.
 */

export type AspectName = "1:1" | "4:5" | "16:9";

export const ASPECTS: { name: AspectName; ratio: number }[] = [
  { name: "1:1", ratio: 1 },
  { name: "4:5", ratio: 4 / 5 },
  { name: "16:9", ratio: 16 / 9 },
];

/** The visible crop, in the source image's own pixel space. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longest edge of the exported file. Larger than the 1080 derivative so the
 *  worker still has something to downscale from. */
const MAX_EXPORT_WIDTH = 1440;

const MAX_ZOOM = 4;

/** The crop box at zoom 1: the largest rectangle of this aspect that fits. */
function baseCrop(
  naturalWidth: number,
  naturalHeight: number,
  ratio: number,
): { width: number; height: number } {
  if (naturalWidth / naturalHeight > ratio) {
    return { width: naturalHeight * ratio, height: naturalHeight };
  }
  return { width: naturalWidth, height: naturalWidth / ratio };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function computeCrop(
  naturalWidth: number,
  naturalHeight: number,
  ratio: number,
  zoom: number,
  centre: { x: number; y: number },
): CropRect {
  const base = baseCrop(naturalWidth, naturalHeight, ratio);
  const width = base.width / zoom;
  const height = base.height / zoom;

  // Keep the rectangle inside the image, whatever the pointer did.
  const x = clamp(centre.x, width / 2, naturalWidth - width / 2) - width / 2;
  const y =
    clamp(centre.y, height / 2, naturalHeight - height / 2) - height / 2;

  return { x, y, width, height };
}

/** Render the crop to a JPEG. The only place the canvas is touched. */
export async function cropToBlob(
  image: HTMLImageElement,
  rect: CropRect,
): Promise<Blob> {
  const outWidth = Math.min(MAX_EXPORT_WIDTH, Math.round(rect.width));
  const outHeight = Math.round(outWidth * (rect.height / rect.width));

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a canvas context.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    outWidth,
    outHeight,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the cropped image."));
      },
      "image/jpeg",
      0.92,
    );
  });
}

interface CropStageProps {
  src: string;
  ratio: number;
  /** Fires whenever the crop changes, and once the image has loaded. */
  onChange: (rect: CropRect, image: HTMLImageElement) => void;
  className?: string;
}

export function CropStage({ src, ratio, onChange, className }: CropStageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: 0, y: 0 });

  /**
   * The stage's rendered width, as state rather than a ref read.
   *
   * Reading `frameRef.current.clientWidth` during render is unsound — the
   * value is not part of the render's inputs, so React has no reason to
   * re-render when it changes, and the eslint rule that caught this is right.
   * A ResizeObserver makes the measurement an input like any other, and gets
   * a responsive stage for free.
   */
  const [frameWidth, setFrameWidth] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrameWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Report upward whenever anything that defines the crop moves.
  useEffect(() => {
    const image = imageRef.current;
    if (!natural || !image) return;
    onChange(computeCrop(natural.w, natural.h, ratio, zoom, centre), image);
  }, [natural, ratio, zoom, centre, onChange]);

  const onLoad = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    setCentre({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 });
    setZoom(1);
  }, []);

  const crop = natural
    ? computeCrop(natural.w, natural.h, ratio, zoom, centre)
    : null;

  const displayScale = crop && frameWidth > 0 ? frameWidth / crop.width : 1;

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !natural) return;

      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = { ...drag, x: event.clientX, y: event.clientY };

      // Dragging right moves the image right, which moves the crop left.
      setCentre((current) => ({
        x: current.x - dx / displayScale,
        y: current.y - dy / displayScale,
      }));
    },
    [natural, displayScale],
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }, []);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={frameRef}
        className={cn(
          "relative w-full touch-none overflow-hidden rounded-[8px] border border-seam bg-black shadow-[0_8px_22px_rgba(0,0,0,0.18)]",
          "cursor-grab active:cursor-grabbing",
        )}
        style={{ aspectRatio: String(ratio) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL
            for a file the user picked a moment ago; next/image would optimise
            a blob it cannot fetch, and this element is never in the DOM of a
            page anyone else loads. */}
        <img
          ref={imageRef}
          src={src}
          alt=""
          onLoad={onLoad}
          draggable={false}
          className="absolute max-w-none origin-top-left select-none"
          style={
            natural && crop
              ? {
                  width: natural.w * displayScale,
                  height: natural.h * displayScale,
                  left: -crop.x * displayScale,
                  top: -crop.y * displayScale,
                }
              : { opacity: 0 }
          }
        />
        {/* Rule-of-thirds guides. Hairlines, no fill — the same restraint the
            feed uses between posts. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute inset-y-0 left-1/3 w-px bg-ink/10" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-ink/10" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-ink/10" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-ink/10" />
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3 rounded-[14px] border border-seam bg-panel px-3">
        <span className="meta">zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => {
            setZoom(Number(event.target.value));
          }}
          className="h-2 w-full appearance-none rounded-full bg-seam accent-accent"
          aria-label="Zoom"
        />
        <span className="meta tabular-nums">{zoom.toFixed(2)}x</span>
      </label>
    </div>
  );
}
