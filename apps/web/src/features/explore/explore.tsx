"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, Spinner, cn } from "@repo/ui";

import { useInfiniteScroll } from "@/features/shared/use-infinite-scroll";
import { api } from "@/lib/api";

import { PostTile } from "./post-tile";

type Post = Schemas["Post"];

/**
 * Explore — a grid, not a feed.
 *
 * The feed answers "what did the people I chose post?". This answers "who
 * else is here?", and the difference has to show in the layout or it is the
 * same page twice. So: the contact sheet's tight 2px gutters rather than the
 * feed's full-width prints, because scanning many is a different act from
 * reading one.
 *
 * No frame numbers. `02-DESIGN-SYSTEM.md` allows them on a profile because a
 * contact sheet genuinely *is* a numbered sequence — someone's roll of film.
 * A discovery grid is an arbitrary set of other people's posts, so numbering
 * it would be decoration pretending to be information, which the same
 * paragraph rules out for everywhere else.
 */
export function Explore() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const inFlight = useRef(false);
  /** Guards the mount fetch against a second run in development. */
  const started = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setBusy(true);

    const from = cursor;
    void api
      .GET("/api/posts/explore", {
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
        setPosts((current) =>
          from === null ? page.posts : [...current, ...page.posts],
        );
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
      });
  }, [cursor, hasMore]);

  /**
   * The first page loads because the page opened, not because a sentinel was
   * seen.
   *
   * The feed derives both from one intersection observer, which is elegant
   * and makes first paint depend on layout and on the browser actually
   * compositing — an observer computes nothing in a tab that is not being
   * rendered, and then the grid sits on placeholders forever with no error to
   * explain it. Loading page one directly costs one `useEffect` and removes
   * that whole class of silence.
   */
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadMore();
  }, [loadMore]);

  /**
   * Subsequent pages arrive 600px before the end, so a page is there before
   * anyone reaches the bottom — the difference between an infinite scroll and
   * a "load more" button that clicks itself late.
   *
   * Observer *and* scroll listener; see the hook for why one is not enough.
   */
  const { sentinel } = useInfiniteScroll(loadMore, { rootMargin: 600 });

  if (loaded && posts.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="font-display text-display-l text-ink-faint">
          Nothing to explore
        </p>
        <p className="mt-2 meta">every public post is already in your feed</p>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h1 className="px-4 pb-4 font-display text-display-l text-ink">Explore</h1>

      <ul className="grid grid-cols-3 gap-[2px]">
        {posts.map((post) => (
          <PostTile key={post.id} post={post} />
        ))}

        {!loaded &&
          Array.from({ length: 9 }, (_, index) => (
            <li key={`skeleton-${String(index)}`} className="aspect-square">
              {/* `still` here and nowhere else: nine sweeps running at once
                  in a tight grid is worse than none, which is the case the
                  design system's no-shimmer rule was actually about. */}
              <Skeleton still className="size-full rounded-none" />
            </li>
          ))}
      </ul>

      {/* A button, not just a spinner — see `features/requests` for why.
          Infinite scroll stays the primary path; this is what makes the rest
          of the grid reachable by keyboard, and in the contexts where an
          observer never fires and no scroll event is ever dispatched. */}
      {loaded && hasMore ? (
        <div className="flex justify-center py-10">
          <Button variant="secondary" disabled={busy} onClick={loadMore}>
            {busy ? <Spinner label="Loading more posts" /> : "Load more"}
          </Button>
        </div>
      ) : null}

      {loaded && !hasMore && posts.length > 0 ? (
        <p className="meta py-10 text-center">that is everything</p>
      ) : null}

      <div
        ref={sentinel}
        aria-hidden="true"
        className={cn("h-px", !hasMore && "hidden")}
      />
    </div>
  );
}
