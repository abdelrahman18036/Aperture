"use client";

import { PostTile } from "@/features/explore/post-tile";


import type { Post } from "@/features/feed/use-feed";

/**
 * The profile grid, as a contact sheet.
 *
 * Photographers review work on a contact sheet — a grid with a frame-number
 * gutter — so the profile is one too. Three columns, **2px gutters** rather
 * than the usual 4–8px, because contact sheets are tight, and a frame number
 * running down the left in `meta` type.
 *
 * The numbering is legitimate here because a contact sheet genuinely *is* a
 * numbered sequence. `02-DESIGN-SYSTEM.md` is explicit that numbered markers
 * appear nowhere else in the product.
 */
export function ContactSheet({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-display text-display-l text-ink">No frames yet</p>
        <p className="meta">nothing has been printed</p>
      </div>
    );
  }

  // Rows of three, so the frame number can sit beside its row rather than
  // beside every image.
  const rows: Post[][] = [];
  for (let index = 0; index < posts.length; index += 3) {
    rows.push(posts.slice(index, index + 3));
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {rows.map((row, rowIndex) => (
        <div key={row[0]?.id ?? rowIndex} className="flex gap-[2px]">
          <span
            aria-hidden="true"
            className="meta w-6 shrink-0 pt-1 text-right tabular-nums"
          >
            {String(rowIndex * 3 + 1).padStart(2, "0")}
          </span>

          {/* The same tile the explore grid uses. It was a bare
              `DevelopImage` guarded on `width && height`, which a video row
              satisfies — so a video post rendered an image element pointed at
              image derivatives that do not exist for it, and the cell came
              out solid grey. */}
          <ul className="grid flex-1 grid-cols-3 gap-[2px]">
            {row.map((post) => (
              <PostTile key={post.id} post={post} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
