"use client";

import { Repeat2 } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Repost, as a toggle.
 *
 * Optimistic like the like button and for the same reason — both endpoints
 * are idempotent, so a double press cannot land in a state the server
 * disagrees with, and waiting on a round trip to change a colour is the
 * difference between a control that feels connected and one that feels laggy.
 *
 * Safelight when on, not daylight. Reposting is something *you* did, and warm
 * is you — daylight is reserved for what is happening live somewhere else.
 * No burst, no bounce: the motion budget is spent on the develop-in.
 */
export function RepostButton({
  postId,
  reposted,
  count,
  onChange,
}: {
  postId: string;
  reposted: boolean;
  count: number;
  onChange?: (reposted: boolean, count: number) => void;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(() => {
    if (busy) return;
    setBusy(true);

    const next = !reposted;
    const nextCount = Math.max(0, count + (next ? 1 : -1));
    onChange?.(next, nextCount);

    const request = next
      ? api.POST("/api/posts/{post_id}/repost", {
          params: { path: { post_id: postId } },
        })
      : api.DELETE("/api/posts/{post_id}/repost", {
          params: { path: { post_id: postId } },
        });

    void request.then((response) => {
      setBusy(false);
      // The server's own numbers win. It knows about the other tab.
      if (response.data === undefined) {
        onChange?.(reposted, count);
        return;
      }
      onChange?.(response.data.viewer_has_reposted, response.data.repost_count);
    });
  }, [busy, count, onChange, postId, reposted]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={reposted}
      aria-label={reposted ? "Undo your repost" : "Repost this"}
      className={cn(
        "flex items-center gap-2 transition-colors duration-[var(--duration-hover)]",
        reposted ? "text-safelight" : "text-ink-dim hover:text-ink",
      )}
    >
      <Repeat2 className="size-6" aria-hidden="true" />
      <span className="meta tabular-nums">{count}</span>
    </button>
  );
}
