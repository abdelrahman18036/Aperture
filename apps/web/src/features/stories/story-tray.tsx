"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Skeleton, cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
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
  const [entries, setEntries] = useState<TrayEntry[] | null>(null);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const started = useRef(false);

  const load = useCallback(() => {
    void api.GET("/api/stories/tray").then((response) => {
      setEntries(response.data ?? []);
    });
  }, []);

  // Loaded because the page opened, not because something was scrolled into
  // view — the mistake the feed and explore both made.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  if (entries === null) {
    return (
      <div className="flex gap-4 border-b border-line px-4 py-4">
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
      <div className="border-b border-line">
        <ul className="flex gap-4 overflow-x-auto px-4 py-4">
          {/* Yours first and always present, because "add one" is the only
              way into the composer's story mode and a tray that hides it
              until you have already posted is a door with no handle. */}
          <li className="shrink-0">
            <Link
              href="/compose?to=story"
              className="flex w-16 flex-col items-center gap-2"
              aria-label="Add to your story"
            >
              <span className="relative grid size-14 place-items-center rounded-full ring-1 ring-line">
                <Plus className="size-5 text-ink-dim" aria-hidden="true" />
              </span>
              <span className="w-full truncate text-center meta">yours</span>
            </Link>
          </li>

          {entries.map((entry, index) => (
            <li key={entry.author.id} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  setOpenAt(index);
                }}
                className="flex w-16 flex-col items-center gap-2"
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
                    "w-full truncate text-center meta",
                    entry.all_seen ? "text-ink-faint" : "text-ink-dim",
                  )}
                >
                  {entry.author.username}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {openAt !== null ? (
        <StoryViewer
          entries={entries}
          startAt={openAt}
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
