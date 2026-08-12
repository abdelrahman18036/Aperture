"use client";

import type * as React from "react";

/**
 * Turn the URLs inside a caption into links, leaving everything else alone.
 *
 * **Returns React nodes, never a string of HTML.** The obvious implementation
 * — a regex replace producing `<a href=...>` and a `dangerouslySetInnerHTML`
 * — takes text somebody typed and hands it to the browser as markup, which is
 * stored XSS with extra steps. Splitting into an array of strings and
 * elements means React escapes every text run for us and there is no path by
 * which a caption becomes markup.
 *
 * The pattern matches `core/links.py`'s, so the link the server previewed and
 * the link shown here are the same span of text.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Characters that end a sentence rather than a URL. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function Linkify({ text }: { text: string }): React.JSX.Element {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index;

    // Trailing punctuation belongs to the sentence, not the address —
    // "see https://example.com." is a full stop, not a hostname.
    const trimmed = raw.replace(TRAILING, "");

    if (start > cursor) nodes.push(text.slice(cursor, start));

    nodes.push(
      <a
        key={`${String(start)}-${trimmed}`}
        href={trimmed}
        target="_blank"
        // `noopener` above all: without it the opened page gets a handle on
        // this one through `window.opener`.
        rel="noopener noreferrer nofollow"
        className="text-safelight underline underline-offset-2"
      >
        {trimmed}
      </a>,
    );

    // Anything trimmed off the end is ordinary text and goes back.
    if (trimmed.length < raw.length) nodes.push(raw.slice(trimmed.length));
    cursor = start + raw.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
