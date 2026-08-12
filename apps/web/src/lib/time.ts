/**
 * Relative time, in the two registers this product uses.
 *
 * There were three copies of this arithmetic — the feed, the conversation
 * header and the activity list — and they had already drifted: one said
 * "NOW", one said "just now", and the third rounded days differently. One
 * module, two exported shapes, because there genuinely are two: a mono
 * timestamp beside a photograph and a sentence fragment inside a line of
 * prose.
 *
 * Both are coarse on purpose. "14 minutes ago" is a precision nobody asked
 * for and a re-render every sixty seconds to keep honest.
 */

/** `NOW`, `12 MIN`, `3 HR`, `14 SEP`. The mono stamp beside a photograph. */
export function stamp(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "NOW";
  if (minutes < 60) return `${String(minutes)} MIN`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} HR`;
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .toUpperCase();
}

/** `just now`, `12 min ago`, `yesterday`. The form that sits inside a sentence. */
export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${String(days)} days ago`;
}
