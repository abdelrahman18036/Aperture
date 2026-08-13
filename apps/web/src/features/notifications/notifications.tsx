"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, Spinner, cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { useRealtimeEvents } from "@/features/realtime/provider";
import { useInfiniteScroll } from "@/features/shared/use-infinite-scroll";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

type Notification = Schemas["Notification"];

/** The sentence each verb makes. The emoji, for a reaction, is the detail. */
function phrase(item: Notification): string {
  switch (item.verb) {
    case "like":
      return "liked your post";
    case "comment":
      return "commented on your post";
    case "follow":
      return "started following you";
    case "follow_request":
      return "asked to follow you";
    case "repost":
      return "reposted your post";
    case "story_reaction":
      return `reacted ${item.detail} to your story`;
    case "mention":
      return "mentioned you";
    default:
      return "did something";
  }
}

/**
 * Everything that happened to you, newest first.
 *
 * Read rather than actionable: a follow request has its own queue at
 * `/requests` where it can be approved, and duplicating those buttons here
 * would mean two places showing the same pending state and one of them going
 * stale. This links there instead.
 *
 * Marked read on open, in one call, rather than per row as they scroll past.
 * The count in the rail is "things you have not looked at", and opening the
 * page is looking at them.
 */
export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const started = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    const from = cursor;
    void api
      .GET("/api/notifications/list", {
        params: { query: from !== null ? { cursor: from } : {} },
      })
      .then((response) => {
        inFlight.current = false;
        setBusy(false);
        setLoaded(true);
        if (response.data === undefined) {
          setError(
            "Activity could not be synchronized. Try again when you are ready.",
          );
          return;
        }
        const page = response.data;
        setItems((current) => {
          if (from === null) return page.notifications;
          const known = new Set(current.map((item) => item.id));
          return [
            ...current,
            ...page.notifications.filter((item) => !known.has(item.id)),
          ];
        });
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
      });
  }, [cursor, hasMore]);

  // Same reasoning as `Requests`: the first page loads because the page
  // opened, not because a sentinel was seen.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadMore();
    // Marking read is the shell's job — it owns the number in the rail, and
    // two callers would race over what the count is.
  }, [loadMore]);

  const { sentinel } = useInfiniteScroll(loadMore);

  /**
   * A notification arriving while the page is open goes on top.
   *
   * The event carries only a verb, so this refetches the first page rather
   * than rendering the payload — the payload is a signal, and the list is the
   * only place blocks and deleted accounts are applied. Merged by id rather
   * than replacing, so anything already scrolled past stays where it is.
   */
  useRealtimeEvents(
    useCallback((event) => {
      if (event.type !== "notification.created") return;
      void api.GET("/api/notifications/list").then((response) => {
        const fresh = response.data?.notifications;
        if (fresh === undefined) return;
        setItems((current) => {
          const known = new Set(current.map((row) => row.id));
          return [...fresh.filter((row) => !known.has(row.id)), ...current];
        });
      });
      // Read on arrival, because it arrived onto a screen being looked at.
      // In a handler rather than an effect, so this is not a cascading render.
      void api.POST("/api/notifications/read");
    }, []),
  );

  return (
    <div
      data-wide
      className="overflow-hidden rounded-instrument border border-seam bg-panel shadow-instrument"
    >
      <header className="flex flex-col gap-1 border-b border-seam px-5 py-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          Activity
        </h1>
        <p className="text-sm text-ink-dim">
          Reactions, replies, mentions, and new connections in one live stream.
        </p>
      </header>

      {error === null ? null : (
        <div
          role="alert"
          className="mx-4 my-4 flex flex-wrap items-center justify-between gap-3 border border-danger/30 bg-danger/5 p-3"
        >
          <p className="text-body text-danger">{error}</p>
          <Button variant="secondary" disabled={busy} onClick={loadMore}>
            Try again
          </Button>
        </div>
      )}

      {!loaded ? (
        <ul className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <li
              key={index}
              className="flex items-center gap-4 border-b border-line px-4 py-3"
            >
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-3 w-48" />
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-4 border-b border-seam px-5 py-4",
                "transition-colors hover:bg-key",
              )}
            >
              <UserAvatar user={item.actor} />
              <p className="min-w-0 flex-1 text-sm text-ink-dim">
                <span className="font-semibold text-ink">
                  {item.actor.username}
                </span>{" "}
                {phrase(item)}{" "}
                <span className="meta">{relativeTime(item.created_at)}</span>
              </p>

              {item.thumbnail_url === null ? null : (
                /* A plain `img` and no develop-in: the thumbnail is a
                   40px pointer to a post, not a photograph being presented,
                   and the signature motion is spent on the feed. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail_url}
                  alt=""
                  className="size-10 shrink-0 rounded-image object-cover"
                />
              )}

              {item.read_at === null ? (
                <>
                  <span className="sr-only">Unread. </span>
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full bg-commit"
                  />
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {/* Clickable, for the reasons recorded in `Requests`. */}
      {loaded && hasMore ? (
        <div className="flex justify-center py-8">
          <Button variant="secondary" disabled={busy} onClick={loadMore}>
            {busy ? <Spinner label="Loading more activity" /> : "Load more"}
          </Button>
        </div>
      ) : null}

      {loaded && error === null && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="font-display text-display-l text-ink">Nothing yet</p>
          <p className="text-body text-ink-dim">
            Likes, comments, and follows will appear here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
