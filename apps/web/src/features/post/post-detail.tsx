"use client";

import { ChevronLeft, Flag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, DialogTrigger, Skeleton, SurfaceState, cn } from "@repo/ui";

import { FeedPost } from "@/features/feed/feed-post";
import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { useRealtimeApi } from "@/features/realtime/provider";
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
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [commentsError, setCommentsError] = useState(false);
  // Already known by the shell's socket, so this costs no extra request. It
  // is null until `connection.ready` arrives, which only means the delete
  // control appears a moment later rather than never.
  const { viewerId } = useRealtimeApi();
  const router = useRouter();

  /**
   * Whose conversation this is.
   *
   * A repost routes every action to the original — the like, the comment
   * count, the repost count — so the comments have to go to the same place.
   * Threading them onto the repost instead would split one conversation into
   * as many as there are reposts, each invisible from the others.
   *
   * Null until the post loads, which is why the comment effect waits on it.
   */
  const subjectId = post === null ? null : (post.reposted_from?.id ?? post.id);

  useEffect(() => {
    void api
      .GET("/api/posts/{post_id}", { params: { path: { post_id: postId } } })
      .then((response) => {
        if (response.data === undefined) {
          if (response.response.status === 404) setMissing(true);
          else setLoadError(true);
          return;
        }
        setPost(response.data);
      });
  }, [postId, reloadKey]);

  const loadComments = useCallback(() => {
    if (subjectId === null) return;
    void api
      .GET("/api/posts/{post_id}/comments", {
        params: { path: { post_id: subjectId } },
      })
      .then((response) => {
        if (response.data === undefined) {
          setCommentsError(true);
          return;
        }
        setCommentsError(false);
        setComments(response.data.comments);
      });
  }, [subjectId]);

  useEffect(loadComments, [loadComments]);

  const removeComment = useCallback(async (commentId: string) => {
    const response = await api.DELETE("/api/posts/comments/{comment_id}", {
      params: { path: { comment_id: commentId } },
    });
    if (response.response.status === 204) {
      // Dropped locally rather than refetched. The row is soft-deleted and
      // every read path already filters it, so a round trip would only
      // confirm what we know.
      setComments((current) => current.filter((item) => item.id !== commentId));
      // And the count with it. The server decrements it on the queue, so
      // leaving this alone shows "no comments" directly beneath "view all 1
      // comment" until a worker catches up — two true-ish numbers
      // contradicting each other on the same screen.
      setPost((current) =>
        current === null
          ? current
          : {
              ...current,
              comment_count: Math.max(0, current.comment_count - 1),
            },
      );
    }
  }, []);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const body = draft.trim();
    if (body === "") return;

    setSending(true);
    setError(null);

    if (subjectId === null) return;
    void api
      .POST("/api/posts/{post_id}/comments", {
        params: { path: { post_id: subjectId } },
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
        // Same reasoning as the delete path: the count is a counter moved on
        // the queue, so it lags unless this moves it too.
        setPost((current) =>
          current === null
            ? current
            : { ...current, comment_count: current.comment_count + 1 },
        );
      });
  }

  if (missing) {
    return (
      <SurfaceState
        variant="empty"
        title="Post unavailable"
        description="It may have been removed or the address may be incorrect."
        action={<Button render={<Link href="/" />}>Back to feed</Button>}
        className="my-8"
      />
    );
  }

  if (loadError) {
    return (
      <SurfaceState
        variant="error"
        title="Post did not load"
        description="We couldn’t load this post."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setLoadError(false);
              setReloadKey((value) => value + 1);
            }}
          >
            Try again
          </Button>
        }
        className="my-8"
      />
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
    <article className="mx-auto w-full max-w-[78rem] px-1 py-3 sm:px-2 sm:py-6">
      {/* A post reached from the feed, a profile or a copied link had no way
          back inside the page — only the browser's own button, which is not
          there at all when the link was opened fresh. */}
      <button
        type="button"
        onClick={() => {
          router.back();
        }}
        className="mb-4 flex min-h-10 items-center gap-1 rounded-full px-3 text-sm text-ink-dim transition-colors hover:bg-panel hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back
      </button>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.72fr)]">
        <FeedPost post={post} />

        <aside className="rounded-instrument border border-seam bg-panel shadow-instrument lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-hidden">
          <section
            aria-label="Comments"
            className="flex max-h-[inherit] flex-col"
          >
            <header className="border-b border-seam px-5 py-5">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">
                Conversation
              </h2>
              <p className="mt-1 text-sm text-ink-dim">
                {comments.length === 0
                  ? "Be the first to respond."
                  : `${String(comments.length)} ${comments.length === 1 ? "response" : "responses"}`}
              </p>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <h3 className="sr-only">
                {comments.length === 0
                  ? "No comments yet"
                  : `${String(comments.length)} ${comments.length === 1 ? "comment" : "comments"}`}
              </h3>

              {commentsError ? (
                <SurfaceState
                  variant="error"
                  title="Comments did not load"
                  action={
                    <Button variant="secondary" onClick={loadComments}>
                      Try again
                    </Button>
                  }
                  compact
                  className="my-3"
                />
              ) : null}

              <ul className="flex flex-col divide-y divide-seam">
                {comments.map((comment) => (
                  <li
                    key={comment.id}
                    className="group flex gap-3 py-3 first:pt-0"
                  >
                    <UserAvatar
                      user={comment.author}
                      className="size-7 shrink-0"
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/u/${comment.author.username}`}
                        className="text-label text-ink"
                      >
                        {comment.author.username}
                      </Link>{" "}
                      <span className="text-body text-ink-dim">
                        {comment.body}
                      </span>
                    </div>

                    {/* Your own comment is deleted, not reported. `DELETE
                  /api/posts/comments/{id}` has existed since Phase 4 with
                  nothing calling it — there was no way to take back a
                  comment at all. */}
                    {viewerId !== null && comment.author.id === viewerId ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete this comment"
                        className="ml-auto opacity-100 transition-opacity duration-[var(--duration-hover)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        onClick={() => {
                          void removeComment(comment.id);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : (
                      <ReportDialog
                        subjectType="comment"
                        subjectId={comment.id}
                        trigger={
                          <DialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="ml-auto opacity-100 transition-opacity duration-[var(--duration-hover)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                aria-label={`Report this comment from ${comment.author.username}`}
                              />
                            }
                          >
                            <Flag aria-hidden="true" />
                          </DialogTrigger>
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <form
              onSubmit={submit}
              className="flex items-end gap-2 border-t border-seam bg-panel-raised p-4"
            >
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
                  "min-h-11 flex-1 rounded-control border border-seam bg-panel px-3 py-2 text-body text-ink",
                  // No `outline-none`: the global focus-visible ring is the one
                  // that satisfies the quality floor, and a border colour is not
                  // a substitute for it.
                  "placeholder:text-ink-faint focus-visible:border-focus",
                )}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={sending || draft.trim() === ""}
              >
                Post
              </Button>
            </form>

            {error !== null && (
              <p
                className="border-t border-danger/30 px-4 py-3 text-body text-danger"
                role="alert"
              >
                {error}
              </p>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}
