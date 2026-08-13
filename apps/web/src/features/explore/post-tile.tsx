"use client";

import { Heart, Images, MapPin, MessageCircle, Play } from "lucide-react";
import Link from "next/link";

import type { Schemas } from "@repo/api-client";
import { DevelopImage, cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { stamp } from "@/lib/time";

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
export function PostTile({
  post,
  featured = false,
}: {
  post: Post;
  featured?: boolean;
}) {
  // A repost carries no media of its own — the original does. Without this
  // fallthrough every repost is an empty square in the grid, which is what
  // the contact sheet showed the first time one existed.
  const source = post.reposted_from ?? post;
  const media = source.media[0];
  const isVideo = media?.kind === "video";

  return (
    <li
      className={cn(
        "min-w-0 overflow-hidden rounded-instrument border border-seam bg-panel transition-[border-color,box-shadow,transform] duration-[var(--duration-hover)]",
        "hover:-translate-y-0.5 hover:border-seam-strong hover:shadow-instrument motion-reduce:hover:translate-y-0",
        featured && "sm:col-span-2 sm:row-span-2",
      )}
    >
      <Link
        href={`/p/${post.id}`}
        className="group flex h-full flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={
          `${source.author.username}: ${source.caption || "post"} — ` +
          `${String(source.like_count)} likes, ${String(source.comment_count)} comments`
        }
      >
        <span
          className={cn(
            "relative block overflow-hidden bg-key",
            featured ? "aspect-[4/3]" : "aspect-square",
          )}
        >
          {media === undefined ? (
            <span className="grid size-full place-items-center text-sm text-ink-dim">
              Media processing
            </span>
          ) : (
            <DevelopImage
              src={
                (isVideo ? media.poster_url : media.sources.at(-1)?.url) ??
                media.original_url ??
                ""
              }
              sources={isVideo ? [] : media.sources}
              alt={media.alt_text}
              width={featured ? 4 : 1}
              height={featured ? 3 : 1}
              blurhash={media.blurhash}
              dominantColor={media.dominant_color}
              sizes={featured ? "(max-width: 640px) 100vw, 760px" : "380px"}
            />
          )}

          {isVideo || source.media.length > 1 ? (
            <span className="absolute right-3 top-3 flex min-h-8 items-center gap-1.5 rounded-full bg-black/70 px-2.5 text-xs font-medium text-white backdrop-blur-sm">
              {isVideo ? (
                <Play className="size-3.5 fill-current" aria-hidden="true" />
              ) : (
                <Images className="size-3.5" aria-hidden="true" />
              )}
              {source.media.length > 1 ? source.media.length : "Video"}
            </span>
          ) : null}
        </span>

        <span className={cn("flex flex-1 flex-col p-4", featured && "sm:p-5")}>
          <span className="flex items-center gap-3">
            <UserAvatar user={source.author} className="size-9 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">
                {source.author.display_name || source.author.username}
              </span>
              <span className="block truncate text-xs text-ink-dim">
                @{source.author.username} · {stamp(source.created_at)}
              </span>
            </span>
          </span>

          <span
            className={cn(
              "mt-3 text-sm leading-6 text-ink",
              featured ? "line-clamp-3" : "line-clamp-2 min-h-12",
            )}
          >
            {source.caption || "Untitled work"}
          </span>

          <span className="mt-auto flex items-center gap-4 pt-4 text-xs font-medium text-ink-dim">
            <span className="flex items-center gap-1.5">
              <Heart className="size-4" aria-hidden="true" />
              {compact(source.like_count)}
            </span>
            <span className="flex items-center gap-1.5">
              <MessageCircle className="size-4" aria-hidden="true" />
              {compact(source.comment_count)}
            </span>
            {source.location ? (
              <span className="ml-auto flex min-w-0 items-center gap-1.5">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{source.location}</span>
              </span>
            ) : null}
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
