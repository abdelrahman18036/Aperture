"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, Spinner } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { useInfiniteScroll } from "@/features/shared/use-infinite-scroll";
import { api } from "@/lib/api";

type PendingRequest = Schemas["FollowRequest"];

/**
 * Follow requests, as a place rather than a section.
 *
 * It was the third tab of Settings, behind a cap of fifty and a line of copy
 * apologising for it. A queue with a count belongs in the sidebar next to the
 * other places, because that is the only arrangement where the count is seen
 * without going to look for it — and a queue nobody sees is a queue nobody
 * works.
 *
 * Cursor pagination, not offset. Requests are answered while the list is
 * open; everything below slides up, and an offset would start the next page
 * past whatever moved.
 */
export function Requests() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const inFlight = useRef(false);
  const started = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setBusy(true);

    const from = cursor;
    void api
      .GET("/api/users/requests", {
        params: { query: from !== null ? { cursor: from } : {} },
      })
      .then((response) => {
        inFlight.current = false;
        setBusy(false);
        setLoaded(true);
        if (response.data === undefined) {
          setHasMore(false);
          return;
        }
        const page = response.data;
        setRequests((current) =>
          from === null ? page.requests : [...current, ...page.requests],
        );
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
      });
  }, [cursor, hasMore]);

  // The first page loads because the page opened, not because a sentinel was
  // seen — an observer computes nothing in a tab that is not compositing, and
  // this screen would sit on skeletons forever with no error to explain it.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadMore();
  }, [loadMore]);

  const { sentinel } = useInfiniteScroll(loadMore);

  const respond = useCallback(async (username: string, accept: boolean) => {
    const response = await api.POST("/api/users/{username}/respond", {
      params: { path: { username } },
      body: { accept },
    });
    if (response.response.status === 204) {
      // Dropped locally rather than refetched. The row is gone either way,
      // and refetching would also reshuffle everything below it under the
      // reader's cursor.
      setRequests((current) =>
        current.filter((item) => item.follower.username !== username),
      );
    }
  }, []);

  return (
    <div className="py-6">
      <header className="flex flex-col gap-2 px-4 pb-4">
        <h1 className="font-display text-display-l text-ink">Requests</h1>
        <p className="meta">people asking to follow you</p>
      </header>

      {!loaded ? (
        <ul className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <li
              key={index}
              className="flex items-center gap-4 border-b border-line px-4 py-3"
            >
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="flex flex-col">
        {requests.map((request) => (
          <li
            key={request.follower.id}
            className="flex items-center gap-4 border-b border-line px-4 py-3"
          >
            <UserAvatar user={request.follower} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body text-ink">
                {request.follower.username}
              </span>
              {request.follower.display_name ? (
                <span className="truncate meta">
                  {request.follower.display_name}
                </span>
              ) : null}
            </div>
            <div className="ml-auto flex shrink-0 gap-2">
              <Button
                onClick={() => {
                  void respond(request.follower.username, true);
                }}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void respond(request.follower.username, false);
                }}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {/* A button, not just a spinner.

          Infinite scroll is the primary path and stays the primary path, but
          it is invisible to a keyboard and silent when it fails — and it does
          fail: an `IntersectionObserver` computes nothing in a document that
          is not compositing, and some embedded contexts dispatch no scroll
          events at all. Both are true of the browser this was verified in.
          Without something clickable, the rest of the list is simply
          unreachable there, and nothing says so. */}
      {loaded && hasMore ? (
        <div className="flex justify-center py-8">
          <Button variant="secondary" disabled={busy} onClick={loadMore}>
            {busy ? <Spinner label="Loading more requests" /> : "Load more"}
          </Button>
        </div>
      ) : null}

      {loaded && requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="font-display text-display-l text-ink">Nobody waiting</p>
          <p className="meta">requests appear here when your account is private</p>
        </div>
      ) : null}
    </div>
  );
}
