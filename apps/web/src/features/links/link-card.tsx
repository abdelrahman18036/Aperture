"use client";

import type { Schemas } from "@repo/api-client";

type LinkPreview = Schemas["LinkPreview"];

/**
 * The card under a caption that has a link in it.
 *
 * **Everything on it is somebody else's HTML.** `title`, `description` and
 * `site_name` are strings found in `<meta>` tags on a page we do not control,
 * so they are rendered as text and never as markup, and the image is loaded
 * from whatever host the page named. React escapes by default, which is what
 * makes that safe — but it is worth saying out loud, because the one thing
 * that must never happen here is a `dangerouslySetInnerHTML`.
 *
 * A hairline rule and a 2px radius, like everything else. A link is
 * information attached to a post, not a second post.
 */
export function LinkCard({ preview }: { preview: LinkPreview }) {
  // `pending` means the worker has not been round yet, and `failed` means
  // the page yielded nothing worth showing. Neither is a card.
  if (preview.state !== "ready") return null;

  const host = hostOf(preview.url);

  return (
    <a
      href={preview.url}
      target="_blank"
      // `noopener` is the one that matters: without it the opened page gets
      // a handle on this one through `window.opener`.
      rel="noopener noreferrer nofollow"
      className="flex overflow-hidden rounded-image border border-line transition-colors duration-[var(--duration-hover)] hover:border-ink-faint"
    >
      {preview.image_url ? (
        // A plain `img`, not `DevelopImage`: the develop-in is for
        // photographs somebody posted, and this is a thumbnail from a page.
        // No blurhash exists for it either, because we never processed it.
        <img
          src={preview.image_url}
          alt=""
          loading="lazy"
          className="size-24 shrink-0 object-cover"
        />
      ) : null}

      <span className="flex min-w-0 flex-col justify-center gap-1 px-3 py-2">
        <span className="meta truncate">{preview.site_name || host}</span>
        <span className="line-clamp-2 text-body text-ink">{preview.title}</span>
        {preview.description ? (
          <span className="line-clamp-1 text-body text-ink-dim">
            {preview.description}
          </span>
        ) : null}
      </span>
    </a>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
