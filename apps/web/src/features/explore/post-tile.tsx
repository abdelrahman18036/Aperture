"use client";

import { Heart, MessageCircle, Play } from "lucide-react";
import Link from "next/link";

import type { Schemas } from "@repo/api-client";
import { DevelopImage, cn } from "@repo/ui";

type Post = Schemas["Post"];

/**
 * One square in a grid of posts.
 *
 * **The grid used to be anonymous squares.** A cell showed a photograph and
 * nothing else — no author, no sign whether anyone had reacted to it, no
 * indication that a video was a video. Deciding what to open meant opening
 * things, which is the opposite of what a discovery grid is for.
 *
 * So the cell carries what every social grid carries: whose it is, and how
 * it has done. Both are already in the payload — `author`, `like_count`,
 * `comment_count` — so this costs nothing but markup.
 *
 * **On a pointer it appears on hover; on touch it is always there.** A phone
 * has no hover, so hiding it behind one would mean the counts existed and
 * could never be seen, which is a mistake this codebase has already made
 * once with the report control.
 *
 * The video badge is not hover-gated at all. Whether a thing moves when you
 * open it is information you want *before* deciding to.
 */
export function PostTile({ post }: { post: Post }) {
  // A repost carries no media of its own — the original does. Without this
  // fallthrough every repost is an empty square in the grid, which is what
  // the contact sheet showed the first time one existed.
  const source = post.reposted_from ?? post;
  const media = source.media[0];
  const isVideo = media?.kind === "video";

  return (
    <li className="relative aspect-square">
      <Link
        href={`/p/${post.id}`}
        className="group block size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-safelight-dim"
        aria-label={
          `${source.author.username}: ${source.caption || "post"} — ` +
          `${String(source.like_count)} likes, ${String(source.comment_count)} comments`
        }
      >
        {media === undefined ? (
          <div className="size-full bg-surface" />
        ) : (
          /* A still, even for video. The poster is what the worker derived,
             and a grid where nine clips decode at once is a grid nobody can
             scroll. */
          <DevelopImage
            src={
              (isVideo
                ? media.poster_url
                : media.sources.at(-1)?.url) ??
              media.original_url ??
              ""
            }
            sources={isVideo ? [] : media.sources}
            alt={media.alt_text}
            width={1}
            height={1}
            blurhash={media.blurhash}
            dominantColor={media.dominant_color}
            sizes="(max-width: 640px) 33vw, 210px"
          />
        )}

        {isVideo ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-base/60 text-ink"
          >
            <Play className="size-3 translate-x-px" />
          </span>
        ) : null}

        {/* The overlay. A wash from the bottom rather than a flat scrim, so
            the photograph is still a photograph underneath it. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2",
            "bg-gradient-to-t from-base/85 via-base/45 to-transparent pt-8",
            "transition-opacity duration-[var(--duration-hover)]",
            // Always on touch, on hover or keyboard focus elsewhere.
            "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100",
          )}
        >
          <span className="truncate meta text-ink">
            {source.author.username}
          </span>
          <span className="flex items-center gap-3 meta text-ink-dim">
            <span className="flex items-center gap-1">
              <Heart className="size-3" />
              <span className="tabular-nums">{compact(source.like_count)}</span>
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="size-3" />
              <span className="tabular-nums">
                {compact(source.comment_count)}
              </span>
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** 12.3K rather than 12341 — a grid cell has room for four characters. */
function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
