"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * "Load the next page when the reader nears the end."
 *
 * **Two mechanisms, deliberately.** An `IntersectionObserver` is the right
 * primitive and is what runs almost always; a passive `scroll` listener sits
 * behind it as a backstop.
 *
 * That is not belt-and-braces for its own sake. An observer computes nothing
 * in a document that is not being composited — an inactive tab, an embedded
 * webview, a headless or offscreen context — and when it silently declines to
 * fire, an infinite list simply stops. This codebase has shipped that exact
 * failure twice: the feed sat on skeletons forever, and so did explore, both
 * with no error to explain it.
 *
 * The scroll listener is passive and does nothing but compare two numbers, so
 * the cost of having it is a subtraction per frame while scrolling. The cost
 * of not having it is a feature that appears broken and logs nothing.
 *
 * Both call the same guarded `onMore`, which the caller is expected to make
 * idempotent — mine hold an `inFlight` ref — so a double fire is a no-op.
 */
export function useInfiniteScroll(
  onMore: () => void,
  { rootMargin = 400 }: { rootMargin?: number } = {},
): { sentinel: React.RefObject<HTMLDivElement | null> } {
  const sentinel = useRef<HTMLDivElement | null>(null);
  // `useEffectEvent`, not a ref written during render. Both effects need the
  // *current* callback without re-subscribing when its identity changes —
  // which it does on every page — and a ref assigned in the render body is
  // exactly what the compiler rejects.
  const fire = useEffectEvent(() => {
    onMore();
  });

  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fire();
      },
      { rootMargin: `${String(rootMargin)}px` },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [rootMargin]);

  useEffect(() => {
    function check(): void {
      const node = sentinel.current;
      if (node === null) return;
      // The same question the observer answers, asked directly: is the end
      // of the list within `rootMargin` of the bottom of the viewport?
      if (node.getBoundingClientRect().top - window.innerHeight < rootMargin) {
        fire();
      }
    }

    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [rootMargin]);

  return { sentinel };
}
