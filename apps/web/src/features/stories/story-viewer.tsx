"use client";

import { ChevronLeft, ChevronRight, Eye, Flag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, DevelopImage, DialogTrigger, cn } from "@repo/ui";

import { LinkCard } from "@/features/links/link-card";
import { Linkify } from "@/features/links/linkify";
import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type TrayEntry = Schemas["StoryTrayEntry"];
type StoryViewerRow = Schemas["StoryViewer"];

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
  viewerId,
  onClose,
}: {
  entries: TrayEntry[];
  startAt: number;
  /** Who is watching, so the header knows whether these frames are theirs. */
  viewerId: string | null;
  onClose: () => void;
}) {
  const [authorIndex, setAuthorIndex] = useState(startAt);
  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Elapsed on the current frame, carried across a pause. */
  const elapsedRef = useRef(0);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<StoryViewerRow[]>([]);

  const entry = entries[authorIndex];
  const story = entry?.stories[frameIndex];

  /** Advance one frame, then one author, then close. */
  const next = useCallback(() => {
    setElapsed(0);
    elapsedRef.current = 0;
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
    elapsedRef.current = 0;
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

  /**
   * The clock.
   *
   * Advancing happens in the timer callback, not inside the `setElapsed`
   * updater. React runs updater functions during render, so calling `next()`
   * from one meant setting state on the *tray* mid-render of the viewer —
   * "Cannot update a component while rendering a different component", which
   * React reported and which would eventually have shown up as a frame that
   * skipped or a ring that failed to update.
   *
   * Progress is measured against a wall-clock start rather than accumulated
   * per tick, so a throttled background tab does not desynchronise the bar
   * from the advance. The ref carries elapsed across a pause without putting
   * it in the dependency array, which would restart the interval every tick.
   */
  useEffect(() => {
    if (paused) return;
    const from = Date.now() - elapsedRef.current;
    const timer = setInterval(() => {
      const runFor = Date.now() - from;
      elapsedRef.current = runFor;
      if (runFor >= FRAME_MS) next();
      else setElapsed(runFor);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [paused, next, frameIndex, authorIndex]);

  // Whose it is decides what the header offers. Compared by author rather
  // than trusting the tray's ordering, which puts your own entry wherever
  // "unwatched first" happens to place it.
  const mine = entry !== undefined && entry.author.id === viewerId;

  // The viewer list, for your own frames only. Fetched when the frame
  // changes rather than when the panel opens, so the count beside the eye is
  // right before anybody asks for the names.
  useEffect(() => {
    if (!mine || story === undefined) {
      return;
    }
    void api
      .GET("/api/stories/{story_id}/viewers", {
        params: { path: { story_id: story.id } },
      })
      .then((response) => {
        setViewers(response.data ?? []);
      });
  }, [mine, story]);

  const remove = useCallback(async () => {
    if (story === undefined) return;
    const response = await api.DELETE("/api/stories/{story_id}", {
      params: { path: { story_id: story.id } },
    });
    // Closing rather than advancing: the frame that was on screen no longer
    // exists, and the tray behind this is about to be refetched anyway.
    if (response.response.status === 204) onClose();
  }, [story, onClose]);

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

        {/* Your own story gets a viewer count and a delete instead of a
            report. Both endpoints existed with nothing calling them — the
            same dead-end this codebase keeps producing when an API lands
            before its screen. */}
        {mine ? (
          <>
            <button
              type="button"
              onClick={() => {
                setShowViewers(!showViewers);
              }}
              aria-expanded={showViewers}
              className="flex items-center gap-1.5 meta text-ink-dim hover:text-ink"
            >
              <Eye className="size-4" aria-hidden="true" />
              <span className="tabular-nums">{viewers.length}</span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete this story"
              onClick={() => {
                void remove();
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </>
        ) : null}

        {/* Not on your own. `file_report` refuses it outright, so offering
            it is offering a control that cannot work — the same mistake the
            comment row made before the delete branch replaced it. */}
        {mine ? null : (
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
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X aria-hidden="true" />
        </Button>
      </header>

      {showViewers ? (
        <div className="border-b border-line px-4 pb-3">
          {viewers.length === 0 ? (
            <p className="meta">nobody yet</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {viewers.map((row) => (
                <li key={row.viewer.id} className="flex items-center gap-2">
                  <UserAvatar user={row.viewer} className="size-6" />
                  <span className="meta">{row.viewer.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        // A text story is words on a ground, so the ground is the frame.
        // The CSS comes from the server resolved, which is what lets a new
        // background ship without touching this file.
        style={media === null ? { background: story.background_css } : undefined}
      >
        {/* Words, centred, with room to breathe — the whole content rather
            than a caption under something else. It scales down as it gets
            longer, which is the one thing every text-status feature does and
            the reason a 700-character limit is livable. */}
        {media === null ? (
          <p
            className={cn(
              "max-w-prose px-8 text-center text-ink [text-wrap:balance]",
              story.text.length > 280
                ? "text-body"
                : story.text.length > 90
                  ? "text-title"
                  : "font-display text-display-l",
            )}
          >
            <Linkify text={story.text} />
          </p>
        ) : null}

        {media?.width && media.height ? (
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

      {story.link_preview ? (
        <div className="px-4 pt-3">
          <LinkCard preview={story.link_preview} />
        </div>
      ) : null}

      {story.caption ? (
        <p className="px-4 pb-6 pt-3 text-center text-body text-ink">
          <Linkify text={story.caption} />
        </p>
      ) : (
        <div className="pb-6" />
      )}
    </div>
  );
}
