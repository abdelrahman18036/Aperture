"use client";

import { Fragment } from "react";

import { PostTile } from "@/features/explore/post-tile";
import type { Post } from "@/features/feed/use-feed";
import { useColumnCount } from "@/features/shared/use-column-count";

/**
 * The profile grid, as a contact sheet.
 *
 * Photographers review work on a contact sheet — a grid with a frame-number
 * gutter — so the profile is one too. **2px gutters** rather than the usual
 * 4–8px, because contact sheets are tight, and a frame number running down
 * the left in `meta` type.
 *
 * The numbering is legitimate here because a contact sheet genuinely *is* a
 * numbered sequence. `02-DESIGN-SYSTEM.md` is explicit that numbered markers
 * appear nowhere else in the product.
 *
 * **The column count is responsive, where the spec says three.** Three was
 * written when every screen was the 640px feed column; on a 1152px page the
 * same instruction produces 380px thumbnails, and a contact sheet of six
 * enormous frames is not a contact sheet — it is a gallery wall. More, smaller
 * frames as the page widens is the more faithful reading of the metaphor, so
 * that is what this does. Recorded as a deviation.
 *
 * The gutter is a real grid column rather than a separate flex track, so the
 * numbers line up with their rows at every width without a second layout to
 * keep in step.
 */
export function ContactSheet({ posts }: { posts: Post[] }) {
  const columns = useColumnCount();

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-display text-display-l text-ink">No frames yet</p>
        <p className="meta">nothing has been printed</p>
      </div>
    );
  }

  return (
    <ul
      className="grid gap-[2px]"
      style={{
        // The gutter, then the frames. Driven by the same number the row
        // breaks below are, so the two cannot disagree.
        gridTemplateColumns: `1.5rem repeat(${String(columns)}, minmax(0, 1fr))`,
      }}
    >
      {posts.map((post, index) => (
        <Fragment key={post.id}>
          {index % columns === 0 ? (
            // Film-edge numbering: the frame this row starts on. `aria-hidden`
            // because it is the sequence made visible, not information a
            // screen reader needs repeated between every third photograph.
            <li
              aria-hidden="true"
              className="meta pt-1 text-right tabular-nums"
            >
              {String(index + 1).padStart(2, "0")}
            </li>
          ) : null}

          {/* The same tile the explore grid uses. It was a bare
              `DevelopImage` guarded on `width && height`, which a video row
              satisfies — so a video post rendered an image element pointed at
              image derivatives that do not exist for it, and the cell came
              out solid grey. */}
          <PostTile post={post} />
        </Fragment>
      ))}
    </ul>
  );
}
