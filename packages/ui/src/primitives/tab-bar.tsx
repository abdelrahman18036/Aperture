"use client";

import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * A row of tabs.
 *
 * **A 1px underline, not a pill and not a filled block.** The design system
 * caps the accent at "rings, icon fills, 1px underlines" and rules out
 * anything accent-filled above 40px tall, so the selected tab is marked by
 * the thinnest possible thing and by ink weight — which is also how a
 * newspaper marks a section, and what every social app settles on once the
 * chrome is stripped back.
 *
 * Proper tab semantics rather than a row of buttons: `role="tablist"` with
 * roving `tabindex` and arrow keys, so a keyboard moves through the set with
 * one Tab stop rather than one per tab.
 */

export interface TabDefinition<T extends string> {
  id: T;
  label: string;
}

export function TabBar<T extends string>({
  tabs,
  active,
  onSelect,
  badges,
  className,
}: {
  tabs: readonly TabDefinition<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Optional count per tab id — a waiting queue, an unread total. */
  badges?: Partial<Record<T, number>>;
  className?: string;
}): React.JSX.Element {
  function move(direction: 1 | -1): void {
    const index = tabs.findIndex((tab) => tab.id === active);
    // Wraps. A tab strip is a ring, not a line with two dead ends.
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next) onSelect(next.id);
  }

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className={cn("flex gap-1 rounded-control bg-key p-1", className)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const count = badges?.[tab.id] ?? 0;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            // Only the selected tab is in the tab order; arrows do the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onSelect(tab.id);
            }}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-[10px] border px-3 py-2 text-label",
              "transition-colors duration-[var(--duration-hover)]",
              selected
                ? "border-seam bg-panel-raised text-commit shadow-key"
                : "border-transparent text-ink-dim hover:text-ink",
            )}
          >
            {tab.label}
            {count > 0 ? (
              // Daylight: a queue waiting on you is something happening now,
              // and the design system puts that on the cool side.
              <span className="rounded-full px-1.5 meta text-live ring-1 ring-live-muted tabular-nums">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
