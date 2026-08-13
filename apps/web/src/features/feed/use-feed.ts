"use client";

import { useCallback, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";

import { api } from "@/lib/api";

export type Post = Schemas["Post"];

/**
 * The feed, one cursor page at a time.
 *
 * The cursor is a snowflake, so "load more" is literally "older than the last
 * one I have". No offsets, so nothing shifts or repeats when someone posts
 * while you are reading.
 *
 * **There is no mount effect.** The first page is fetched by the same
 * intersection sentinel that fetches every other page — it is on screen when
 * the list is empty, so it fires immediately. That is not a trick to satisfy
 * a lint: it means there is one loading path rather than two, and "load the
 * page when its trigger is visible" is true of the first page as much as the
 * fortieth.
 */
export function useFeed(): {
  posts: Post[];
  loading: boolean;
  initialised: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Throw the feed away and fetch page one. For "N new posts". */
  refresh: () => void;
} {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against the observer firing twice before a page lands.
  const inFlight = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setLoading(true);

    const from = cursor;
    void api
      .GET("/api/posts/feed", {
        params: { query: from ? { cursor: from } : {} },
      })
      .then((response) => {
        inFlight.current = false;
        setLoading(false);
        setInitialised(true);

        if (response.data === undefined) {
          setError("Could not load the feed.");
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

  const refresh = useCallback(() => {
    // Resetting the cursor is what makes the next `loadMore` fetch page one.
    // The posts are cleared with it, because a fresh page prepended to a
    // stale list would duplicate everything the two have in common.
    inFlight.current = false;
    setPosts([]);
    setCursor(null);
    setHasMore(true);
    setInitialised(false);
    setError(null);
  }, []);

  return { posts, loading, initialised, error, hasMore, loadMore, refresh };
}
