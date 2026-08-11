"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Heart } from "lucide-react";
import { useState } from "react";

import { cn } from "@repo/ui";

/**
 * Like.
 *
 * `02-DESIGN-SYSTEM.md`'s entire budget for this: icon scale 1 → 1.15 → 1 over
 * 180ms, plus a safelight ring that expands and fades. **No particle bursts.**
 *
 * Warm, because a like is something *you* do. Nothing cool appears here.
 *
 * Optimistic: the count moves on the click and the request follows. Both the
 * like and the unlike endpoints are idempotent, so a double tap costs nothing
 * and needs no reasoning about ordering.
 */
export function LikeButton({
  liked,
  count,
  onToggle,
}: {
  liked: boolean;
  count: number;
  onToggle: (next: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [ringKey, setRingKey] = useState(0);

  return (
    <button
      type="button"
      onClick={() => {
        if (!liked && !reduceMotion) setRingKey((n) => n + 1);
        onToggle(!liked);
      }}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      className="relative flex items-center gap-2 text-ink-dim hover:text-ink"
    >
      <span className="relative grid size-6 place-items-center">
        <AnimatePresence>
          {ringKey > 0 && liked ? (
            <motion.span
              key={ringKey}
              aria-hidden="true"
              initial={{ scale: 0.6, opacity: 0.7 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute size-6 rounded-full ring-2 ring-safelight"
            />
          ) : null}
        </AnimatePresence>

        <motion.span
          animate={reduceMotion ? {} : { scale: liked ? [1, 1.15, 1] : 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="grid place-items-center"
        >
          <Heart
            className={cn(
              "size-6 transition-colors duration-[var(--duration-hover)]",
              liked && "fill-safelight text-safelight",
            )}
            aria-hidden="true"
          />
        </motion.span>
      </span>

      <span className="meta tabular-nums">{count}</span>
    </button>
  );
}
