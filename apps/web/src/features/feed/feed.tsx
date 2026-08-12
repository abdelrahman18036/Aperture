"use client";

import { useEffect, useRef } from "react";

import { Skeleton, Spinner } from "@repo/ui";

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
  const { posts, loading, initialised, error, hasMore, loadMore } = useFeed();
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
    <div className="flex flex-col">
      <StoryTray />

      {posts.map((post) => (
        <FeedPost key={post.id} post={post} />
      ))}

      {/* Always mounted: it is the trigger for every page including the
          first, so it must exist before there is anything to scroll past. */}
      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {error !== null ? (
        <p className="py-16 text-body text-danger">{error}</p>
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
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="font-display text-display-l text-ink">Nothing yet</p>
          <p className="meta max-w-xs">
            follow someone, or make the first print yourself
          </p>
        </div>
      ) : null}

      {initialised && posts.length > 0 && !hasMore ? (
        <p className="meta py-16 text-center">that is everything</p>
      ) : null}
    </div>
  );
}

function FeedSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 border-b border-line py-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <Skeleton className="aspect-[4/5] w-full" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
