"use client";

import { ChevronLeft, ChevronRight, Flag, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, DevelopImage, DialogTrigger, cn } from "@repo/ui";

import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type TrayEntry = Schemas["StoryTrayEntry"];

/** How long one frame holds before it advances itself. */
const FRAME_MS = 5000;
/** Progress ticks. 50ms is smooth enough and cheap enough. */
const TICK_MS = 50;

/**
 * Full-screen story playback.
 *
 * **The progress bars are the navigation.** One segment per frame, filling in
 * real time — which is the one place in this product where an animation is
 * carrying information rather than decorating a transition, so it is exempt
 * from the motion budget in a way a scroll reveal would not be.
 *
 * Advancing is: tap the right half, press Right, or wait. Going back is the
 * left half or Left. Escape closes. Those are the four gestures every story
 * viewer has settled on, and inventing a fifth would only make this one
 * harder to use.
 *
 * The whole thing renders over the app rather than as a route, because it is
 * a mode rather than a place — closing it should put you back exactly where
 * you were, including your scroll position.
 */
export function StoryViewer({
  entries,
  startAt,
  onClose,
}: {
  entries: TrayEntry[];
  startAt: number;
  onClose: () => void;
}) {
  const [authorIndex, setAuthorIndex] = useState(startAt);
  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);

  const entry = entries[authorIndex];
  const story = entry?.stories[frameIndex];

  /** Advance one frame, then one author, then close. */
  const next = useCallback(() => {
    setElapsed(0);
    const frames = entries[authorIndex]?.stories.length ?? 0;
    if (frameIndex + 1 < frames) {
      setFrameIndex(frameIndex + 1);
      return;
    }
    if (authorIndex + 1 < entries.length) {
      setAuthorIndex(authorIndex + 1);
      setFrameIndex(0);
      return;
    }
    onClose();
  }, [authorIndex, entries, frameIndex, onClose]);

  const previous = useCallback(() => {
    setElapsed(0);
    if (frameIndex > 0) {
      setFrameIndex(frameIndex - 1);
      return;
    }
    if (authorIndex > 0) {
      const before = authorIndex - 1;
      setAuthorIndex(before);
      // Land on their *last* frame: going back should be the reverse of
      // going forward, not a jump to the start of the previous person.
      setFrameIndex(Math.max((entries[before]?.stories.length ?? 1) - 1, 0));
    }
  }, [authorIndex, entries, frameIndex]);

  // Mark it watched as soon as it is on screen. The endpoint is idempotent,
  // so a re-render or a second tab costs one 204.
  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (story === undefined || marked.current.has(story.id)) return;
    marked.current.add(story.id);
    void api.POST("/api/stories/{story_id}", {
      params: { path: { story_id: story.id } },
    });
  }, [story]);

  // The clock. One interval for the whole viewer rather than one per frame,
  // so there is nothing to leak when frames change fast.
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setElapsed((current) => {
        if (current + TICK_MS >= FRAME_MS) {
          next();
          return 0;
        }
        return current + TICK_MS;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [paused, next]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [next, previous, onClose]);

  if (entry === undefined || story === undefined) return null;

  const media = story.media;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${entry.author.username}'s story`}
      className="fixed inset-0 z-50 flex flex-col bg-base"
    >
      {/* One segment per frame. Filled behind, filling now, empty ahead. */}
      <div className="flex gap-1 px-3 pt-3">
        {entry.stories.map((frame, index) => (
          <span
            key={frame.id}
            className="h-0.5 flex-1 overflow-hidden bg-line"
            aria-hidden="true"
          >
            <span
              className="block h-full bg-ink"
              style={{
                width:
                  index < frameIndex
                    ? "100%"
                    : index === frameIndex
                      ? `${String((elapsed / FRAME_MS) * 100)}%`
                      : "0%",
              }}
            />
          </span>
        ))}
      </div>

      <header className="flex items-center gap-3 px-4 py-3">
        <UserAvatar user={entry.author} className="size-8" />
        <span className="min-w-0 flex-1 truncate text-label text-ink">
          {entry.author.username}
        </span>

        <ReportDialog
          subjectType="story"
          subjectId={story.id}
          trigger={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Report this story"
                />
              }
            >
              <Flag aria-hidden="true" />
            </DialogTrigger>
          }
        />
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {media.width && media.height ? (
          /* Fills the frame and crops, which is what a story is — and
             also the only sizing that resolves here. `max-h-full` alone
             gives a ratio-sized box nothing to compute from, so the wrapper
             came out 0×0 over a perfectly loaded image; a `w-auto` variant
             failed the same way. An explicit height is what the chain
             needs. */
          <div className="size-full">
            <DevelopImage
              src={media.sources.at(-1)?.url ?? media.original_url ?? ""}
              sources={media.sources}
              alt={media.alt_text}
              width={media.width}
              height={media.height}
              blurhash={media.blurhash}
              dominantColor={media.dominant_color}
              priority
              className="size-full"
            />
          </div>
        ) : null}

        {/* Two halves, covering the frame. Buttons rather than a div with a
            click handler, so a keyboard reaches them and a screen reader is
            told what they do. */}
        <button
          type="button"
          onClick={previous}
          onPointerDown={() => {
            setPaused(true);
          }}
          onPointerUp={() => {
            setPaused(false);
          }}
          aria-label="Previous"
          className="absolute inset-y-0 left-0 w-1/3"
        />
        <button
          type="button"
          onClick={next}
          onPointerDown={() => {
            setPaused(true);
          }}
          onPointerUp={() => {
            setPaused(false);
          }}
          aria-label="Next"
          className="absolute inset-y-0 right-0 w-2/3"
        />

        {/* Visible affordances at the edges, for a pointer. The tap halves
            above are invisible by necessity — they sit over the photograph. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-2 grid size-8 place-items-center",
            "rounded-full bg-base/50 text-ink-dim",
            authorIndex === 0 && frameIndex === 0 && "opacity-0",
          )}
        >
          <ChevronLeft className="size-4" />
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 grid size-8 place-items-center rounded-full bg-base/50 text-ink-dim"
        >
          <ChevronRight className="size-4" />
        </span>
      </div>

      {story.caption ? (
        <p className="px-4 pb-6 pt-3 text-center text-body text-ink">
          {story.caption}
        </p>
      ) : (
        <div className="pb-6" />
      )}
    </div>
  );
}
