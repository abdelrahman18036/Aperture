"use client";

import { useSyncExternalStore } from "react";

/**
 * How many columns a photo grid should have at this width.
 *
 * **The one place the number lives.** The contact sheet needs it in
 * JavaScript, not only in CSS, because its frame-number gutter has to emit a
 * cell at the start of every visual row — and a row only exists once you know
 * how wide it is. Deriving it from a Tailwind class would mean the CSS and the
 * numbering disagreeing the first time somebody changed a breakpoint, and the
 * symptom would be numbers landing mid-row.
 *
 * `useSyncExternalStore` rather than a `resize` listener with `setState`: a
 * media query is already an external store with a subscribe and a snapshot,
 * and reading it this way means no state is set during an effect and no
 * render happens for a resize that did not cross a breakpoint.
 *
 * The server snapshot is three, which is what a phone gets. A desktop
 * corrects on hydration, before any image has decoded.
 */

/**
 * Breakpoint → columns, widest first.
 *
 * The band these produce is roughly 110–230px per tile from 375px to 1920px,
 * which is the range where a photograph is still legible as one and a grid
 * still reads as a grid. Three enormous tiles is a gallery; twelve tiny ones
 * is a colour swatch.
 */
const STEPS: readonly { query: string; columns: number }[] = [
  { query: "(min-width: 1280px)", columns: 5 },
  { query: "(min-width: 768px)", columns: 4 },
];

const FALLBACK_COLUMNS = 3;

function subscribe(onChange: () => void): () => void {
  const lists = STEPS.map((step) => window.matchMedia(step.query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function snapshot(): number {
  for (const step of STEPS) {
    if (window.matchMedia(step.query).matches) return step.columns;
  }
  return FALLBACK_COLUMNS;
}

function serverSnapshot(): number {
  return FALLBACK_COLUMNS;
}

export function useColumnCount(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
