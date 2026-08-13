"use client";

import { MessageCircle, MoreHorizontal, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Button, DevelopImage, DevelopVideo, DialogTrigger } from "@repo/ui";

import { LinkCard } from "@/features/links/link-card";
import { Linkify } from "@/features/links/linkify";
import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { useRealtimeApi } from "@/features/realtime/provider";
import { api } from "@/lib/api";
import { stamp } from "@/lib/time";

import { LikeButton } from "./like-button";
import { RepostButton } from "./repost-button";
import { ShareSheet } from "./share-sheet";
import type { Post } from "./use-feed";

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000)
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** The primary media card. Data and actions stay unchanged; the card is calm. */
export function FeedPost({ post }: { post: Post }) {
  const { viewerId } = useRealtimeApi();
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
          setLiked(!next);
          setLikeCount((current) => Math.max(0, current + (next ? -1 : 1)));
          return;
        }
        setLiked(response.data.viewer_has_liked);
        setLikeCount(Math.max(0, response.data.like_count));
      });
    },
    [source.id],
  );

  return (
    <article className="min-w-0 overflow-hidden rounded-instrument border border-seam bg-panel shadow-instrument">
      {repostedBy === null ? null : (
        <p className="flex items-center gap-2 border-b border-seam px-5 py-3 text-xs font-medium text-ink-dim">
          <Repeat2 className="size-3.5" aria-hidden="true" />
          <Link href={`/u/${repostedBy.username}`} className="hover:text-ink">
            {repostedBy.username}
          </Link>
          reposted
        </p>
      )}

      <header className="flex items-center gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <Link
          href={`/u/${source.author.username}`}
          aria-label={source.author.username}
        >
          <UserAvatar user={source.author} className="size-11" />
        </Link>
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/u/${source.author.username}`}
            className="truncate text-sm font-semibold text-ink transition-colors hover:text-safelight"
          >
            {source.author.username}
          </Link>
          <span className="truncate text-xs text-ink-dim">
            {source.location ? `${source.location} · ` : ""}
            {stamp(source.created_at)}
          </span>
        </div>
        {viewerId !== source.author.id ? (
          <ReportDialog
            subjectType="post"
            subjectId={source.id}
            trigger={
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto rounded-full text-ink-dim hover:bg-raised hover:text-ink"
                    aria-label="Report this post"
                  />
                }
              >
                <MoreHorizontal aria-hidden="true" />
              </DialogTrigger>
            }
          />
        ) : null}
      </header>

      <div className="min-w-0 px-2 sm:px-3">
        <div className="flex items-center justify-center overflow-hidden rounded-image bg-key">
          {image?.kind === "video" ? (
            <DevelopVideo
              src={image.video_url ?? image.original_url ?? ""}
              width={image.width ?? 16}
              height={image.height ?? 9}
              blurhash={image.blurhash}
              durationMs={image.duration_ms}
              label={image.alt_text}
              fit="cover"
              className="w-full max-h-[52rem]"
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
              fit="cover"
              sizes="(max-width: 640px) 100vw, 860px"
              className="w-full max-h-[52rem]"
            />
          ) : (
            <p className="grid aspect-[4/3] w-full place-items-center px-8 text-center text-sm text-ink-dim">
              This media is still processing.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 pt-3 sm:px-6 sm:pt-4">
        <LikeButton liked={liked} count={likeCount} onToggle={toggleLike} />
        <Link
          href={`/p/${source.id}`}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-ink-dim transition-colors hover:bg-raised hover:text-ink"
          aria-label={
            source.comment_count === 1
              ? "1 comment"
              : `${String(source.comment_count)} comments`
          }
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          <span className="text-xs tabular-nums">{source.comment_count}</span>
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
        <ShareSheet
          postId={source.id}
          count={shareCount}
          onShared={setShareCount}
        />
      </div>

      <div className="space-y-2 px-5 pb-5 pt-1 sm:px-6 sm:pb-6">
        <p className="text-sm font-semibold text-ink">
          {formatCount(likeCount)} {likeCount === 1 ? "like" : "likes"}
        </p>
        {source.caption ? (
          <p className="text-sm leading-6 text-ink">
            <Link
              href={`/u/${source.author.username}`}
              className="mr-2 font-semibold text-ink hover:text-safelight"
            >
              {source.author.username}
            </Link>
            <Linkify text={source.caption} />
          </p>
        ) : null}
        {source.link_preview ? (
          <LinkCard preview={source.link_preview} />
        ) : null}
        {source.comment_count > 0 ? (
          <Link
            href={`/p/${source.id}`}
            className="block w-fit text-sm text-ink-dim transition-colors hover:text-ink"
          >
            View all {source.comment_count}{" "}
            {source.comment_count === 1 ? "comment" : "comments"}
          </Link>
        ) : null}
        <p className="text-xs text-ink-faint">{stamp(post.created_at)}</p>
      </div>
    </article>
  );
}
