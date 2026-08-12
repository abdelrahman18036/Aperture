"use client";

import { Flag, MessageCircle, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import {
  Button,
  DevelopImage,
  DevelopVideo,
  DialogTrigger,
} from "@repo/ui";

import { LinkCard } from "@/features/links/link-card";
import { Linkify } from "@/features/links/linkify";
import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";
import { stamp } from "@/lib/time";

import { LikeButton } from "./like-button";
import { RepostButton } from "./repost-button";
import { ShareSheet } from "./share-sheet";
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

export function FeedPost({ post }: { post: Post }) {
  /**
   * What is actually being shown.
   *
   * A repost is a `Post` with no media of its own pointing at the one that
   * has it, so every read below — the photograph, the caption, the counts,
   * the id every action posts to — comes from the original. Only the byline
   * above the header belongs to the person who reposted it.
   *
   * The chain is flattened server-side, so this is never more than one deep.
   */
  const source = post.reposted_from ?? post;
  const repostedBy = post.reposted_from === null ? null : post.author;

  const [liked, setLiked] = useState(source.viewer_has_liked);
  const [likeCount, setLikeCount] = useState(source.like_count);
  const [reposted, setReposted] = useState(source.viewer_has_reposted);
  const [repostCount, setRepostCount] = useState(source.repost_count);
  const [shareCount, setShareCount] = useState(source.share_count);

  const image = source.media[0];

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
            params: { path: { post_id: source.id } },
          })
        : api.DELETE("/api/posts/{post_id}/like", {
            params: { path: { post_id: source.id } },
          });

      void call.then((response) => {
        if (!response.data) {
          // The write failed. Put it back where it was.
          setLiked(!next);
          setLikeCount((current) => Math.max(0, current + (next ? -1 : 1)));
          return;
        }

        // Both, now.
        //
        // The count used to be deliberately ignored: counters moved only on
        // the queue, so the number in this response was whatever it was
        // *before* the like, and adopting it visibly undid the optimistic
        // increment. `counters.services.apply_now` moves the cached number in
        // the request that caused it, so the response is correct when it is
        // sent — and adopting it is now the only way two tabs, or a like
        // somebody else made a second ago, ever agree.
        setLiked(response.data.viewer_has_liked);
        setLikeCount(Math.max(0, response.data.like_count));
      });
    },
    [source.id],
  );


  return (
    <article className="flex flex-col gap-3 border-b border-line py-6">
      {/* Who put this in front of you, when that is not who made it. A line
          of meta above the header rather than a badge on the avatar: the
          photograph and its author stay exactly as they read anywhere else,
          and the repost is context around them. */}
      {repostedBy === null ? null : (
        <p className="flex items-center gap-2 meta">
          <Repeat2 className="size-3.5" aria-hidden="true" />
          <Link href={`/u/${repostedBy.username}`} className="hover:text-ink-dim">
            {repostedBy.username}
          </Link>
          reposted
        </p>
      )}

      <header className="flex items-center gap-3">
        <Link
          href={`/u/${source.author.username}`}
          aria-label={source.author.username}
        >
          <UserAvatar user={source.author} />
        </Link>

        <div className="flex min-w-0 flex-col">
          <Link
            href={`/u/${source.author.username}`}
            className="truncate text-body text-ink hover:text-safelight"
          >
            {source.author.username}
          </Link>
          {/* The meta row. Film-edge printing, and true: these are the
              actual properties of the image. */}
          <span className="meta truncate">
            {source.location ? `${source.location} · ` : ""}
            {stamp(source.created_at)}
          </span>
        </div>

        {/* §11: the report button ships before stories. */}
        <ReportDialog
          subjectType="post"
          subjectId={source.id}
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
        {/* A link rather than a button, because it goes somewhere. Both of
            these rendered and did nothing until now — two of the three
            actions under every post in the feed. */}
        <Link
          href={`/p/${source.id}`}
          className="flex items-center gap-2 text-ink-dim hover:text-ink"
          aria-label={
            source.comment_count === 1
              ? "1 comment"
              : `${String(source.comment_count)} comments`
          }
        >
          <MessageCircle className="size-6" aria-hidden="true" />
          <span className="meta tabular-nums">{source.comment_count}</span>
        </Link>
        <RepostButton
          postId={source.id}
          reposted={reposted}
          count={repostCount}
          onChange={(next, nextCount) => {
            setReposted(next);
            setRepostCount(nextCount);
          }}
        />
        {/* Copying the link moved inside the sheet: "send this to someone"
            is one intention with two answers, and as two adjacent icons it
            made the reader choose before knowing what either did. */}
        <ShareSheet
          postId={source.id}
          count={shareCount}
          onShared={setShareCount}
        />
      </div>


      <p className="meta">
        {formatCount(likeCount)} {likeCount === 1 ? "like" : "likes"}
        {image?.width && image.height
          ? ` · ${String(image.width)}×${String(image.height)}`
          : ""}
        {` · ${stamp(post.created_at)}`}
      </p>

      {post.caption ? (
        <p className="text-body text-ink">
          <Link
            href={`/u/${post.author.username}`}
            className="mr-2 text-ink hover:text-safelight"
          >
            {post.author.username}
          </Link>
          <Linkify text={post.caption} />
        </p>
      ) : null}

      {/* The card sits under the caption, not over the photograph — the
          photograph is the post, and a link is information attached to it. */}
      {post.link_preview ? <LinkCard preview={post.link_preview} /> : null}

      {/* Was a `<button>` with no handler — the third dead control on this
          component. The comments live on the post page, so it goes there,
          which also means middle-click and the keyboard work. */}
      {post.comment_count > 0 ? (
        <Link href={`/p/${post.id}`} className="meta w-fit hover:text-ink-dim">
          view all {post.comment_count}{" "}
          {post.comment_count === 1 ? "comment" : "comments"}
        </Link>
      ) : null}
    </article>
  );
}
