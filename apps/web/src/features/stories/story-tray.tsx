"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, SurfaceState, cn } from "@repo/ui";

import type { AnyServerEvent } from "@repo/realtime-events";

import { useCompose } from "@/features/composer/compose-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import {
  useRealtimeApi,
  useRealtimeEvents,
} from "@/features/realtime/provider";
import { api } from "@/lib/api";

import { StoryViewer } from "./story-viewer";

type TrayEntry = Schemas["StoryTrayEntry"];

/**
 * The row above the feed.
 *
 * **The ring is the whole interface.** A full safelight ring means there is
 * something you have not watched; a hairline means you are through it. That
 * is the one piece of state a tray carries, and it is why the API sorts
 * unwatched first — the ordering and the ring have to agree or neither means
 * anything.
 *
 * Warm, not cool. `02-DESIGN-SYSTEM.md` splits the accents by "warm is you,
 * cool is live", and an unwatched story is a thing waiting for *you* rather
 * than a thing happening now. The daylight side stays with presence and
 * typing, which genuinely are live.
 *
 * `--color-line` at 1px when seen, which is the same ring every avatar in
 * the product already wears — so a watched entry returns to looking like an
 * ordinary avatar rather than a dimmed special case.
 */
export function StoryTray() {
  const { start: compose, posted } = useCompose();
  const [entries, setEntries] = useState<TrayEntry[] | null>(null);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const { viewerId } = useRealtimeApi();

  const load = useCallback(() => {
    void api.GET("/api/stories/tray").then((response) => {
      if (response.data === undefined) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setEntries(response.data);
    });
  }, []);

  // Somebody posted. The payload carries an author id and nothing else, so
  // the answer is to refetch — the tray already applies blocks, privacy and
  // expiry, and none of that should be re-derived from a wire payload.
  const onEvent = useCallback(
    (event: AnyServerEvent) => {
      if (event.type === "story.created") load();
    },
    [load],
  );
  useRealtimeEvents(onEvent);

  // Loaded because the page opened, not because something was scrolled into
  // view — the mistake the feed and explore both made. Reloaded whenever
  // something is published, so a story you just posted is in the tray
  // rather than one reload away.
  useEffect(() => {
    if (started.current && posted === 0) return;
    started.current = true;
    load();
  }, [load, posted]);

  if (entries === null) {
    if (failed) {
      return (
        <SurfaceState
          variant="error"
          title="Stories did not load"
          action={
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          }
          compact
          className="my-2"
        />
      );
    }
    return (
      <div className="flex gap-4 rounded-instrument border border-seam bg-panel px-4 py-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-2 w-10" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <section
        aria-label="Stories"
        className="relative overflow-hidden rounded-instrument border border-seam bg-panel px-3 py-4 shadow-instrument sm:px-5"
      >
        <h2 className="sr-only">Stories</h2>
        <ul className="flex snap-x gap-4 overflow-x-auto pb-1 no-scrollbar">
          {/* Yours first and always present, because "add one" is the only
              way into the composer's story mode and a tray that hides it
              until you have already posted is a door with no handle. */}
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => {
                compose("story");
              }}
              className="flex min-h-20 w-16 snap-start flex-col items-center gap-2 rounded-2xl py-1 transition-colors hover:bg-raised"
              aria-label="Add to your story"
            >
              <span className="relative grid size-14 place-items-center rounded-full border-2 border-dashed border-safelight/45 bg-raised text-safelight">
                <Plus className="size-5" aria-hidden="true" />
              </span>
              <span className="w-full truncate text-center text-xs font-medium text-ink-dim">
                Your story
              </span>
            </button>
          </li>

          {entries.map((entry, index) => (
            <li key={entry.author.id} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  setOpenAt(index);
                }}
                className="flex min-h-20 w-16 snap-start flex-col items-center gap-2 rounded-2xl py-1 transition-colors hover:bg-raised"
                aria-label={
                  `${entry.author.username}'s story, ` +
                  `${entry.all_seen ? "watched" : "not watched"}`
                }
              >
                <span
                  className={cn(
                    "rounded-full p-[2px] transition-colors duration-[var(--duration-hover)]",
                    entry.all_seen
                      ? "ring-1 ring-line"
                      : "ring-2 ring-safelight",
                  )}
                >
                  <UserAvatar user={entry.author} className="size-12" />
                </span>
                <span
                  className={cn(
                    "w-full truncate text-center text-xs font-medium",
                    entry.all_seen ? "text-ink-faint" : "text-ink-dim",
                  )}
                >
                  {entry.author.username}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {openAt !== null ? (
        <StoryViewer
          entries={entries}
          startAt={openAt}
          viewerId={viewerId}
          onClose={() => {
            setOpenAt(null);
            // Rings go faint for whatever was just watched. Refetching is one
            // request and avoids reimplementing the server's seen logic here.
            load();
          }}
        />
      ) : null}
    </>
  );
}
