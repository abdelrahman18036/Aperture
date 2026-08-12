"use client";

import { ChevronLeft, ChevronRight, Eye, Flag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, DevelopImage, DialogTrigger, cn } from "@repo/ui";
import { SendHorizontal } from "lucide-react";

import { LinkCard } from "@/features/links/link-card";
import { Linkify } from "@/features/links/linkify";
import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type TrayEntry = Schemas["StoryTrayEntry"];
type StoryViewerRow = Schemas["StoryViewer"];

/**
 * Where to open an entry: the first frame its viewer has not watched.
 *
 * The server computes it — it already holds the `StoryView` rows, and a
 * client deriving it would need a second request for state it was never
 * sent. Zero when everything has been seen, which is right: an entry that is
 * entirely watched is a rewatch, and a rewatch starts at the beginning.
 */
function firstUnwatched(entry: TrayEntry | undefined): number {
  return entry?.first_unseen ?? 0;
}

/**
 * What the reaction row offers.
 *
 * Must match `stories.services.REACTIONS` — the server refuses anything not
 * on its own list, because the emoji rides through to the author's activity
 * feed and an unbounded field there is a place to put anything at all.
 */
const REACTIONS = ["\u2764\ufe0f", "\ud83d\udd25", "\ud83d\ude02", "\ud83d\ude2e", "\ud83d\ude22", "\ud83d\udc4f"] as const;

/** Narrowed by the generated client, which carries the same list. */
type Reaction = (typeof REACTIONS)[number];

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
  /**
   * Start on the first frame they have not watched, then wrap.
   *
   * Opening somebody with four stories and being put back on the first one
   * you already saw is the most annoying thing a story viewer can do — you
   * have to tap past your own history to reach the new thing. So the entry
   * point is the first unseen frame, and only if every frame has been seen
   * does it start from the beginning, which is then a deliberate rewatch.
   *
   * A lazy initialiser rather than an effect: it runs once, on mount, and an
   * effect would set state during the first commit for a value that is knowable
   * before it.
   */
  const [frameIndex, setFrameIndex] = useState(() =>
    firstUnwatched(entries[startAt]),
  );
  /**
   * Which frame this author was entered on, and whether the tail has run.
   *
   * Starting on the first unseen frame means the frames *before* it never
   * play — somebody with four stories, two already watched, would show two
   * and move on. So after the last frame the run wraps to the beginning and
   * plays up to where it came in, and only then moves to the next person.
   *
   * `enteredAt` is 0 for a rewatch, which makes the wrap a no-op: there is
   * nothing before frame zero to come back for.
   */
  const [enteredAt, setEnteredAt] = useState(() => firstUnwatched(entries[startAt]));
  const [wrapped, setWrapped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Elapsed on the current frame, carried across a pause. */
  const elapsedRef = useRef(0);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<StoryViewerRow[]>([]);
  /**
   * What this viewer reacted with, keyed by story id.
   *
   * Seeded from the payload — `viewer_reaction` comes down with the tray, so
   * a frame already reacted to shows it the moment it appears rather than
   * after a request. Overlaid locally as reactions are sent, so the row is
   * correct without refetching the tray.
   */
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState("");
  const [replySent, setReplySent] = useState(false);

  const entry = entries[authorIndex];
  const story = entry?.stories[frameIndex];

  /** Move to the next author, or close if this was the last one. */
  const nextAuthor = useCallback(() => {
    if (authorIndex + 1 >= entries.length) {
      onClose();
      return;
    }
    const at = firstUnwatched(entries[authorIndex + 1]);
    setAuthorIndex(authorIndex + 1);
    // The next person starts at *their* first unseen frame too, and wraps
    // the same way when it runs out.
    setFrameIndex(at);
    setEnteredAt(at);
    setWrapped(false);
  }, [authorIndex, entries, onClose]);

  /** Advance one frame, wrapping to the start once, then one author. */
  const next = useCallback(() => {
    setElapsed(0);
    elapsedRef.current = 0;
    setReplySent(false);
    const frames = entries[authorIndex]?.stories.length ?? 0;

    if (wrapped) {
      // On the way back through what was already seen. Stop where we came in.
      if (frameIndex + 1 < enteredAt) {
        setFrameIndex(frameIndex + 1);
        return;
      }
      nextAuthor();
      return;
    }

    if (frameIndex + 1 < frames) {
      setFrameIndex(frameIndex + 1);
      return;
    }
    if (enteredAt > 0) {
      setFrameIndex(0);
      setWrapped(true);
      return;
    }
    nextAuthor();
  }, [authorIndex, enteredAt, entries, frameIndex, nextAuthor, wrapped]);

  /**
   * React, or take the reaction back by pressing the same one again.
   *
   * Optimistic, and reconciled to nothing on failure rather than to a
   * guess — the endpoint replaces rather than accumulates, so a double press
   * cannot land somewhere the server disagrees with.
   */
  const react = useCallback(
    (emoji: Reaction) => {
      if (story === undefined) return;
      const storyId = story.id;
      const current = reactions[storyId] ?? story.viewer_reaction;
      const clearing = current === emoji;

      setReactions((held) => ({ ...held, [storyId]: clearing ? "" : emoji }));

      void (clearing
        ? api.DELETE("/api/stories/{story_id}/react", {
            params: { path: { story_id: storyId } },
          })
        : api.POST("/api/stories/{story_id}/react", {
            params: { path: { story_id: storyId } },
            body: { emoji },
          }));
    },
    [reactions, story],
  );

  /** Answer a story. It lands in the direct conversation, not anywhere new. */
  const reply = useCallback(() => {
    const body = replyDraft.trim();
    if (story === undefined || body === "") return;
    setReplyDraft("");

    void api
      .POST("/api/stories/{story_id}/reply", {
        params: { path: { story_id: story.id } },
        body: { client_id: crypto.randomUUID(), body },
      })
      .then((response) => {
        // Said either way. A reply that silently did nothing is the failure
        // mode worth avoiding, and the one thing that can go wrong here —
        // being blocked — is not something to explain in a story viewer.
        setReplySent(response.data !== undefined);
      });
  }, [replyDraft, story]);

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
      // Going back into someone lands on their last frame, which is past
      // wherever the forward run entered — so the tail is behind us.
      setEnteredAt(0);
      setWrapped(false);
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
        <p className="px-4 pb-3 pt-3 text-center text-body text-ink">
          <Linkify text={story.caption} />
        </p>
      ) : null}

      {/* Answering a story, when it is not your own.

          A row of emoji and one field, on the frame rather than behind a
          menu: a reaction that takes two taps to reach is a reaction nobody
          sends. The reply goes into the direct conversation — there is no
          second inbox for story replies and no second unread count. */}
      {mine ? (
        <div className="pb-6" />
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-6 pt-3">
          <div className="flex justify-center gap-1">
            {REACTIONS.map((emoji) => {
              const chosen =
                (reactions[story.id] ?? story.viewer_reaction) === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    react(emoji);
                  }}
                  aria-pressed={chosen}
                  aria-label={`React ${emoji}`}
                  className={cn(
                    "grid size-9 place-items-center rounded-full text-title",
                    "transition-colors duration-[var(--duration-hover)]",
                    // A ring, not a filled block: accents stay at small
                    // scale, and a row of filled swatches would spend the
                    // whole accent budget on six buttons.
                    chosen ? "ring-1 ring-safelight" : "hover:bg-surface",
                  )}
                >
                  {emoji}
                </button>
              );
            })}
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              reply();
            }}
          >
            <input
              value={replyDraft}
              onChange={(event) => {
                setReplyDraft(event.target.value);
              }}
              // Typing should not race the frame away underneath you.
              onFocus={() => {
                setPaused(true);
              }}
              onBlur={() => {
                setPaused(false);
              }}
              placeholder={
                replySent ? "Sent" : `Reply to ${entry.author.username}`
              }
              aria-label={`Reply to ${entry.author.username}`}
              className={cn(
                "min-h-9 flex-1 bg-transparent py-2 text-body text-ink",
                "border-b border-line placeholder:text-ink-faint",
                "focus-visible:border-safelight",
              )}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              disabled={replyDraft.trim() === ""}
              aria-label="Send reply"
            >
              <SendHorizontal aria-hidden="true" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
