"use client";

import { Flag, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DevelopImage,
  DevelopVideo,
  DialogTrigger,
} from "@repo/ui";

import { ReportDialog } from "@/features/moderation/report-dialog";
import { api } from "@/lib/api";

import { LikeButton } from "./like-button";
import type { Post } from "./use-feed";

/**
 * One post in the feed.
 *
 * **There is no card.** No border around the image, no radius above 2px, no
 * shadow, no surface behind it. A hairline `--color-line` rule separates one
 * post from the next and the photograph sits directly on the base.
 *
 * `02-DESIGN-SYSTEM.md` calls this the single most consequential layout
 * decision in the product, and it is the one that makes the feed not look like
 * every other clone: a card implies a container, and a photograph is not in a
 * container. It is a print on a table.
 *
 * If a card ever seems necessary here, re-read the reasoning rather than the
 * component.
 */

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatWhen(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "NOW";
  if (minutes < 60) return `${String(minutes)} MIN`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} HR`;
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .toUpperCase();
}

export function FeedPost({ post }: { post: Post }) {
  const [liked, setLiked] = useState(post.viewer_has_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);

  const image = post.media[0];

  const toggleLike = useCallback(
    (next: boolean) => {
      // Optimistic. Both endpoints are idempotent, so a flurry of taps
      // settles wherever the user left it.
      //
      // Clamped at zero: counters are eventually consistent, so the number we
      // started from can already be behind, and an un-like from a stale zero
      // would otherwise render "-1 likes".
      setLiked(next);
      setLikeCount((current) => Math.max(0, current + (next ? 1 : -1)));

      const call = next
        ? api.POST("/api/posts/{post_id}/like", {
            params: { path: { post_id: post.id } },
          })
        : api.DELETE("/api/posts/{post_id}/like", {
            params: { path: { post_id: post.id } },
          });

      void call.then((response) => {
        if (!response.data) {
          // The write failed. Put it back where it was.
          setLiked(!next);
          setLikeCount((current) => Math.max(0, current + (next ? -1 : 1)));
          return;
        }

        // Reconcile `liked` but **not** the count.
        //
        // The Like row is written synchronously, so `viewer_has_liked` in this
        // response is authoritative. The count is not: counters move on the
        // queue via transaction.on_commit, so the number here is whatever it
        // was before this like landed. Adopting it would visibly undo the
        // optimistic increment — which is exactly what it did the first time
        // this was written. Our local delta is the more accurate figure until
        // the next fetch.
        setLiked(response.data.viewer_has_liked);
      });
    },
    [post.id],
  );

  return (
    <article className="flex flex-col gap-3 border-b border-line py-6">
      <header className="flex items-center gap-3">
        <Link href={`/u/${post.author.username}`} aria-label={post.author.username}>
          <Avatar>
            {post.author.avatar_media_id ? (
              <AvatarImage src="" alt="" />
            ) : null}
            <AvatarFallback>
              {post.author.username.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="flex min-w-0 flex-col">
          <Link
            href={`/u/${post.author.username}`}
            className="truncate text-body text-ink hover:text-safelight"
          >
            {post.author.username}
          </Link>
          {/* The meta row. Film-edge printing, and true: these are the
              actual properties of the image. */}
          <span className="meta truncate">
            {post.location ? `${post.location} · ` : ""}
            {formatWhen(post.created_at)}
          </span>
        </div>

        {/* §11: the report button ships before stories. */}
        <ReportDialog
          subjectType="post"
          subjectId={post.id}
          trigger={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="Report this post"
                />
              }
            >
              <Flag aria-hidden="true" />
            </DialogTrigger>
          }
        />
      </header>

      {/* Video and stills are both `media`; only the renderer differs. The
          composer has always accepted video and the worker has always
          processed it — there was simply no branch here, so a video post
          rendered nothing at all. */}
      {image?.kind === "video" ? (
        <DevelopVideo
          src={image.video_url ?? image.original_url ?? ""}
          width={image.width ?? 16}
          height={image.height ?? 9}
          blurhash={image.blurhash}
          durationMs={image.duration_ms}
          label={image.alt_text}
        />
      ) : image?.width && image.height ? (
        <DevelopImage
          src={image.sources.at(-1)?.url ?? image.original_url ?? ""}
          sources={image.sources}
          alt={image.alt_text}
          width={image.width}
          height={image.height}
          blurhash={image.blurhash}
          dominantColor={image.dominant_color}
          sizes="(max-width: 640px) 100vw, 640px"
        />
      ) : null}

      <div className="flex items-center gap-5">
        <LikeButton liked={liked} count={likeCount} onToggle={toggleLike} />
        <button
          type="button"
          className="flex items-center gap-2 text-ink-dim hover:text-ink"
          aria-label="Comments"
        >
          <MessageCircle className="size-6" aria-hidden="true" />
          <span className="meta tabular-nums">{post.comment_count}</span>
        </button>
        <button
          type="button"
          className="text-ink-dim hover:text-ink"
          aria-label="Share"
        >
          <Send className="size-6" aria-hidden="true" />
        </button>
      </div>

      <p className="meta">
        {formatCount(likeCount)} likes
        {image?.width && image.height
          ? ` · ${String(image.width)}×${String(image.height)}`
          : ""}
        {` · ${formatWhen(post.created_at)}`}
      </p>

      {post.caption ? (
        <p className="text-body text-ink">
          <Link
            href={`/u/${post.author.username}`}
            className="mr-2 text-ink hover:text-safelight"
          >
            {post.author.username}
          </Link>
          {post.caption}
        </p>
      ) : null}

      {post.comment_count > 0 ? (
        <button type="button" className="meta w-fit hover:text-ink-dim">
          view all {post.comment_count} comments
        </button>
      ) : null}
    </article>
  );
}
