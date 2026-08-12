"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Avatar, AvatarFallback, Button, Skeleton, cn } from "@repo/ui";

import { FeedPost } from "@/features/feed/feed-post";
import { api } from "@/lib/api";

type Post = Schemas["Post"];
type Comment = Schemas["Comment"];

/**
 * One post, and its comments.
 *
 * The contact sheet and the explore grid have both linked to `/p/{id}` since
 * Phase 4, and until now the route did not exist — every cell on a profile
 * was a 404. The comment endpoints have been there just as long with nothing
 * calling them.
 *
 * The post itself is `FeedPost`, unchanged. A detail page that renders the
 * same photograph differently from the feed is two components to keep in step
 * and two chances for the design to drift; the only thing this page adds is
 * what the feed deliberately leaves out.
 */
export function PostDetail({ postId }: { postId: string }) {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .GET("/api/posts/{post_id}", { params: { path: { post_id: postId } } })
      .then((response) => {
        if (response.data === undefined) {
          setMissing(true);
          return;
        }
        setPost(response.data);
      });
  }, [postId]);

  const loadComments = useCallback(() => {
    void api
      .GET("/api/posts/{post_id}/comments", {
        params: { path: { post_id: postId } },
      })
      .then((response) => {
        if (response.data === undefined) return;
        setComments(response.data.comments);
      });
  }, [postId]);

  useEffect(loadComments, [loadComments]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const body = draft.trim();
    if (body === "") return;

    setSending(true);
    setError(null);

    void api
      .POST("/api/posts/{post_id}/comments", {
        params: { path: { post_id: postId } },
        body: { body },
      })
      .then((response) => {
        setSending(false);
        if (response.data === undefined) {
          // 429 is the interesting one: the comment limiter is a token bucket
          // and saying "slow down" is more use than "something went wrong".
          setError(
            response.response.status === 429
              ? "You are commenting faster than we allow. Try again shortly."
              : "That comment could not be posted.",
          );
          return;
        }
        setDraft("");
        // Appended rather than refetched: the response *is* the new comment,
        // and a round trip to learn what we already know is a round trip.
        setComments((current) => [...current, response.data]);
      });
  }

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="font-display text-display-l text-ink-faint">
          No such post
        </p>
        <p className="mt-2 meta">deleted, or never here</p>
        <Link
          href="/"
          className="mt-6 inline-block text-label text-safelight underline underline-offset-4"
        >
          Back to the feed
        </Link>
      </div>
    );
  }

  if (post === null) {
    return (
      <div className="py-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-2 aspect-square w-full" />
      </div>
    );
  }

  return (
    <article className="py-6">
      <FeedPost post={post} />

      <section aria-label="Comments" className="px-4 pt-6">
        <h2 className="meta">
          {comments.length === 0
            ? "no comments"
            : `${String(comments.length)} ${comments.length === 1 ? "comment" : "comments"}`}
        </h2>

        <ul className="mt-3 flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar className="size-7 shrink-0">
                <AvatarFallback>
                  {comment.author.username.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <Link
                  href={`/u/${comment.author.username}`}
                  className="text-label text-ink"
                >
                  {comment.author.username}
                </Link>{" "}
                <span className="text-body text-ink-dim">{comment.body}</span>
              </div>
            </li>
          ))}
        </ul>

        <form onSubmit={submit} className="mt-6 flex items-end gap-2">
          <label htmlFor="comment-body" className="sr-only">
            Add a comment
          </label>
          <input
            id="comment-body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            maxLength={2200}
            disabled={sending}
            className={cn(
              "min-h-9 flex-1 bg-transparent py-2 text-body text-ink",
              // No `outline-none`: the global focus-visible ring is the one
              // that satisfies the quality floor, and a border colour is not
              // a substitute for it.
              "border-b border-line placeholder:text-ink-faint",
              "focus-visible:border-safelight",
            )}
          />
          <Button type="submit" disabled={sending || draft.trim() === ""}>
            Post
          </Button>
        </form>

        {error !== null && (
          <p className="mt-2 text-body text-danger" role="alert">
            {error}
          </p>
        )}
      </section>
    </article>
  );
}
