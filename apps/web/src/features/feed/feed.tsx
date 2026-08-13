"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Skeleton, Spinner, SurfaceState } from "@repo/ui";

import type { AnyServerEvent } from "@repo/realtime-events";

import { useRealtimeEvents } from "@/features/realtime/provider";
import { StoryTray } from "@/features/stories/story-tray";

import { FeedPost } from "./feed-post";
import { useFeed } from "./use-feed";

/**
 * The feed.
 *
 * **No scroll-triggered reveals.** A feed is for consuming, not for being
 * performed at — animating posts as they scroll in makes the product feel
 * slow and is the fastest way to make it read as AI-generated. The only
 * motion here is the develop-in, once per image, on first paint.
 *
 * The sentinel fetches the next page 800px before the reader reaches it, so
 * the scroll never stops. It also fetches the *first* page, because on an
 * empty list it is already on screen — see `useFeed`.
 */
export function Feed() {
  const [fresh, setFresh] = useState(0);
  const { posts, loading, initialised, error, hasMore, loadMore, refresh } =
    useFeed();

  const onEvent = useCallback((event: AnyServerEvent) => {
    if (event.type === "post.created") setFresh((count) => count + 1);
  }, []);
  useRealtimeEvents(onEvent);
  const sentinel = useRef<HTMLDivElement | null>(null);
  /** Guards the mount fetch against a second run in development. */
  const started = useRef(false);

  /**
   * The first page loads because the page opened, not because a sentinel was
   * seen.
   *
   * Deriving both from one observer is tidy and makes first paint depend on
   * the browser actually compositing — an observer computes nothing in a tab
   * that is not being rendered, and the feed then sits on skeletons forever
   * with no error to explain it. Explore hit exactly this; the feed had the
   * same shape and had simply not been looked at in that state.
   */
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "800px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [loadMore]);

  return (
    <div className="mx-auto flex w-full max-w-[56rem] min-w-0 flex-col gap-5 px-3 py-4 sm:gap-6 sm:px-5 sm:py-6">
      <h1 className="sr-only">Your feed</h1>
      <StoryTray />

      {/* Announced, not inserted.
          Splicing a post into a feed somebody is reading moves what they were
          looking at under their eyes, which is the one thing an infinite list
          must never do. A count they can act on costs one line and takes the
          decision back. */}
      {fresh > 0 ? (
        <button
          type="button"
          onClick={() => {
            setFresh(0);
            window.scrollTo({ top: 0 });
            refresh();
          }}
          className="self-center rounded-full border border-seam bg-panel px-5 py-2.5 text-sm font-medium text-safelight shadow-sm hover:bg-raised"
        >
          {fresh === 1 ? "1 new post" : `${String(fresh)} new posts`}
        </button>
      ) : null}

      {posts.map((post) => (
        <FeedPost key={post.id} post={post} />
      ))}

      {/* Always mounted: it is the trigger for every page including the
          first, so it must exist before there is anything to scroll past. */}
      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {error !== null ? (
        <SurfaceState
          variant="error"
          title="The feed did not load"
          description={error}
          action={
            <Button variant="secondary" onClick={refresh}>
              Try again
            </Button>
          }
          className="my-6"
        />
      ) : null}

      {/* Skeletons for the first paint, a spinner for every page after.
          They answer different questions — "what is coming" versus "is
          anything still happening" — and a second full skeleton post below
          content you are already reading just looks like a broken render. */}
      {!initialised ? <FeedSkeleton count={2} /> : null}

      {initialised && loading ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading more posts" />
        </div>
      ) : null}

      {initialised && posts.length === 0 && error === null ? (
        <SurfaceState
          variant="empty"
          title="Your feed is ready for a first post"
          description="Follow a creator or publish work to begin building your feed."
          className="my-8"
        />
      ) : null}

      {initialised && posts.length > 0 && !hasMore ? (
        <p className="meta py-16 text-center">You are up to date</p>
      ) : null}
    </div>
  );
}

function FeedSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-instrument border border-seam bg-panel p-3 sm:p-5"
        >
          <div className="mb-4 flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <Skeleton className="aspect-[4/3] min-h-80 w-full rounded-image" />
          <div className="pt-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
