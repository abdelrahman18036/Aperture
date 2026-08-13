"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, Spinner, SurfaceState, cn } from "@repo/ui";

import { useInfiniteScroll } from "@/features/shared/use-infinite-scroll";
import { api } from "@/lib/api";

import { PostTile } from "./post-tile";

type Post = Schemas["Post"];

/**
 * Explore — a grid, not a feed.
 *
 * The feed answers "what did the people I chose post?". This answers "who
 * else is here?", and the difference has to show in the layout or it is the
 * same page twice — which is exactly what it was: an identical grid of
 * identical squares, distinguishable from a profile only by the heading.
 *
 * So every seventh tile is printed large. That is not decoration: a wall of
 * equal squares has no entry point and the eye slides off it, and the large
 * frames give it a rhythm to scan by. It stays off below `md`, where two
 * columns of a three-column grid is most of the row and the effect is a
 * lopsided page rather than a rhythm.
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
  const [error, setError] = useState(false);

  const inFlight = useRef(false);
  /** Guards the mount fetch against a second run in development. */
  const started = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);

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
          setError(true);
          return;
        }
        const page = response.data;
        setPosts((current) =>
          from === null ? page.posts : [...current, ...page.posts],
        );
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor !== null);
      })
      .catch(() => {
        inFlight.current = false;
        setBusy(false);
        setLoaded(true);
        setError(true);
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

  if (loaded && posts.length === 0 && !error) {
    return (
      <div className="rounded-[22px] border border-seam bg-panel px-6 py-16 text-center">
        <p className="text-xl font-semibold text-ink">Nothing to explore</p>
        <p className="mt-2 text-sm text-ink-dim">
          Every public post is already in your feed.
        </p>
      </div>
    );
  }

  if (error && posts.length === 0) {
    return (
      <SurfaceState
        variant="error"
        title="Explore did not load"
        description="We couldn’t load discovery right now."
        action={
          <Button variant="secondary" onClick={loadMore}>
            Try again
          </Button>
        }
        className="my-8"
      />
    );
  }

  return (
    <div data-wide className="px-1 py-3 sm:px-2 sm:py-6">
      <header className="mb-7 flex flex-col gap-5 border-b border-seam pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">
            Explore
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-dim sm:text-base">
            Browse public work with the creator, story, and response visible
            before you open it.
          </p>
        </div>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link href="/search" />}
        >
          <Search className="size-4" aria-hidden="true" />
          Find creators
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {/* Three on a phone, more once there is room — the cells stay square
          and the grid stops being a 640px ribbon on a 1920px screen.

          `px-4` to match the heading. Without it the grid ran flush into the
          nav rail on one side and off the window on the other, which read as
          a page that had lost its margins rather than as a full-bleed choice.

          `grid-flow-dense` so the gap a large tile leaves beside it is filled
          by the next small one rather than left as a hole. */}
      <ul
        aria-busy={!loaded}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {posts.map((post, index) => (
          <PostTile key={post.id} post={post} featured={index === 0} />
        ))}

        {!loaded &&
          Array.from({ length: 9 }, (_, index) => (
            <li
              key={`skeleton-${String(index)}`}
              className="overflow-hidden rounded-instrument border border-seam bg-panel"
            >
              {/* `still` here and nowhere else: nine sweeps running at once
                  in a tight grid is worse than none, which is the case the
                  design system's no-shimmer rule was actually about. */}
              <Skeleton still className="aspect-square w-full rounded-none" />
              <div className="space-y-3 p-4">
                <Skeleton still className="h-9 w-40" />
                <Skeleton still className="h-4 w-full" />
                <Skeleton still className="h-4 w-2/3" />
              </div>
            </li>
          ))}
      </ul>

      {!loaded ? (
        <p className="sr-only" role="status">
          Loading public posts
        </p>
      ) : null}

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

      {error && posts.length > 0 ? (
        <SurfaceState
          variant="error"
          title="More work could not be loaded"
          action={
            <Button variant="secondary" onClick={loadMore}>
              Try again
            </Button>
          }
          compact
          className="my-6"
        />
      ) : null}

      {loaded && !hasMore && posts.length > 0 ? (
        <p className="py-10 text-center text-sm text-ink-dim">
          You’ve seen everything.
        </p>
      ) : null}

      <div
        ref={sentinel}
        aria-hidden="true"
        className={cn("h-px", !hasMore && "hidden")}
      />
    </div>
  );
}
