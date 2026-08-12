"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { DevelopImage, DevelopVideo, Skeleton, cn } from "@repo/ui";

import { api } from "@/lib/api";

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

  const inFlight = useRef(false);
  /** Guards the mount fetch against a second run in development. */
  const started = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;

    const from = cursor;
    void api
      .GET("/api/posts/explore", {
        params: { query: from !== null ? { cursor: from } : {} },
      })
      .then((response) => {
        inFlight.current = false;
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
   * Subsequent pages come from the sentinel.
   *
   * `rootMargin` fires it 600px early, so a page arrives before someone
   * reaches the bottom — which is the difference between an infinite scroll
   * and a "load more" button that clicks itself late.
   */
  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

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
        {posts.map((post) => {
          const image = post.media[0];
          return (
            <li key={post.id} className="aspect-square">
              <Link
                href={`/p/${post.id}`}
                className="block size-full"
                aria-label={`${post.author.username}: ${post.caption || "post"}`}
              >
                {image === undefined ? (
                  <Skeleton className="size-full" />
                ) : image.kind === "video" ? (
                  // A grid cell is a still even for video — the poster is the
                  // blurhash, and playing happens on the post page. A grid
                  // where nine videos load is a grid nobody can scroll.
                  <DevelopVideo
                    src={image.video_url ?? image.original_url ?? ""}
                    width={1}
                    height={1}
                    blurhash={image.blurhash}
                    durationMs={image.duration_ms}
                    label={image.alt_text}
                    className="size-full"
                  />
                ) : (
                  <DevelopImage
                    src={image.sources.at(-1)?.url ?? image.original_url ?? ""}
                    sources={image.sources}
                    alt={image.alt_text}
                    // Square cells. A grid of frames, not a masonry wall.
                    width={1}
                    height={1}
                    blurhash={image.blurhash}
                    dominantColor={image.dominant_color}
                    sizes="(max-width: 640px) 33vw, 210px"
                  />
                )}
              </Link>
            </li>
          );
        })}

        {!loaded &&
          Array.from({ length: 9 }, (_, index) => (
            <li key={`skeleton-${String(index)}`} className="aspect-square">
              <Skeleton className="size-full" />
            </li>
          ))}
      </ul>

      <div
        ref={sentinel}
        aria-hidden="true"
        className={cn("h-px", !hasMore && "hidden")}
      />
    </div>
  );
}
