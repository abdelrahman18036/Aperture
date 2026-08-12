"use client";

/**
 * "The rail's numbers are out of date."
 *
 * A DOM event rather than a prop or a context, and that is not laziness. The
 * shell owns the counts; the screens that change them are rendered into it as
 * `{children}` by a **server component** layout, so there is no callback to
 * pass down — the same constraint that made `data-wide` a `:has()` selector
 * rather than a prop.
 *
 * The socket covers everything somebody else does to you. This covers the
 * other half: answering a queue yourself produces no event, because nothing
 * happened that anybody needed telling about.
 */
const COUNTS_STALE = "aperture:counts-stale";

/** Say the counts have changed. Cheap, synchronous, no listeners required. */
export function countsChanged(): void {
  window.dispatchEvent(new CustomEvent(COUNTS_STALE));
}

/** Listen. Returns an unsubscribe function, for use from an effect. */
export function onCountsChanged(listener: () => void): () => void {
  window.addEventListener(COUNTS_STALE, listener);
  return () => {
    window.removeEventListener(COUNTS_STALE, listener);
  };
}
