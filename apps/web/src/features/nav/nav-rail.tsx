"use client";

import {
  Bell,
  Camera,
  Compass,
  House,
  MailOpen,
  MessageCircle,
  Search,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@repo/ui";

import { useCompose } from "@/features/composer/compose-dialog";

/**
 * The nav rail — 72px collapsed, 240px expanded.
 *
 * The widths are from `02-DESIGN-SYSTEM.md` and they are not suggestions: the
 * feed column is fixed at 640px and centred, so the rails are what absorb the
 * window instead of the photographs reflowing.
 *
 * Expanded above 1280px, collapsed to icons below it, and gone entirely on
 * mobile where it becomes a bottom bar.
 */

interface Destination {
  href: string;
  label: string;
  icon: typeof House;
  /** Shown as a daylight pip when non-zero. A queue waiting on you. */
  count?: number;
}

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Feed", icon: House },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/notifications", label: "Activity", icon: Bell },
];

/** Not a destination. Composing happens over the page, not instead of it. */
const COMPOSE: Destination = {
  href: "/compose",
  label: "New post",
  icon: Camera,
};

/**
 * Places that only exist when they have something in them.
 *
 * A permanent "Requests" entry reading zero on an account that is not
 * private is a door to an empty room. They appear with a count and go away
 * when the queue is empty — which also makes the pip mean something, because
 * it is never showing a nought.
 */
function queues(counts: NavCounts): Destination[] {
  return [
    ...(counts.requests > 0
      ? [
          {
            href: "/requests",
            label: "Requests",
            icon: UserPlus,
            count: counts.requests,
          },
        ]
      : []),
    ...(counts.unread > 0
      ? [
          {
            href: "/messages",
            label: "Unread",
            icon: MailOpen,
            count: counts.unread,
          },
        ]
      : []),
  ];
}

export interface NavCounts {
  requests: number;
  unread: number;
  activity: number;
}

/**
 * The counts that belong to a permanent destination rather than to a queue.
 *
 * Activity is always there — unlike Requests, which only exists when it has
 * something in it — so its number rides on the entry instead of conjuring a
 * second one.
 */
function withCounts(items: Destination[], counts: NavCounts): Destination[] {
  return items.map((item) =>
    item.href === "/notifications" && counts.activity > 0
      ? { ...item, count: counts.activity }
      : item,
  );
}

export function NavRail({
  username,
  counts,
}: {
  username: string | null;
  counts: NavCounts;
}) {
  const { start: onCompose } = useCompose();
  const pathname = usePathname();

  const items: Destination[] = [
    ...withCounts(DESTINATIONS, counts),
    ...queues(counts),
    ...(username
      ? [
          { href: `/u/${username}`, label: "Profile", icon: UserRound },
          { href: "/settings", label: "Settings", icon: Settings },
        ]
      : []),
  ];

  return (
    <nav
      aria-label="Primary"
      className={cn(
        // Fixed rather than sticky: the feed scrolls, the rail does not move.
        "fixed inset-y-0 left-0 z-20 hidden flex-col gap-1 border-r border-line",
        "bg-base px-3 py-6 sm:flex",
        "w-nav-rail xl:w-nav-rail-open",
      )}
    >
      <Link
        href="/"
        className="mb-6 flex h-9 items-center gap-3 px-2 text-ink"
        aria-label="Aperture, home"
      >
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full ring-2 ring-safelight"
        />
        <span className="hidden font-display text-title xl:inline">Aperture</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          onCompose("post");
        }}
        aria-label={COMPOSE.label}
        title={COMPOSE.label}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-control px-2",
          "text-label text-ink-dim transition-colors duration-[var(--duration-hover)]",
          "hover:text-ink",
        )}
      >
        <COMPOSE.icon className="size-5 shrink-0" aria-hidden="true" />
        <span aria-hidden="true" className="hidden xl:inline">
          {COMPOSE.label}
        </span>
      </button>

      {items.map(({ href, label, icon: Icon, count }) => {
        const active = pathname === href;
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            // The label below is `hidden` under 1280px, and `display: none`
            // removes it from the accessibility tree as well as the screen —
            // so seven of these eight links had no accessible name at all,
            // and a screen reader announced "link" eight times. `aria-label`
            // is unconditional for that reason. `title` gives a sighted
            // person the same word on hover, which is the whole difference
            // between a rail of icons and a rail of guesses.
            aria-label={count ? `${label}, ${String(count)}` : label}
            title={label}
            className={cn(
              "flex h-10 items-center gap-3 rounded-control px-2",
              "text-label transition-colors duration-[var(--duration-hover)]",
              active ? "text-ink" : "text-ink-dim hover:text-ink",
            )}
          >
            <span className="relative shrink-0">
              <Icon
                className={cn("size-5", active && "text-safelight")}
                aria-hidden="true"
              />
              {/* Daylight, and a dot rather than a number at this width —
                  the count is in the accessible name and spelled out beside
                  the label once the rail expands. */}
              {/* The number, not a dot. "You have messages" is what a dot
                  says; "you have four" is what somebody actually wants, and
                  it fits. */}
              {count ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-daylight px-1 text-center text-[10px] font-semibold leading-4 text-base ring-2 ring-base xl:hidden"
                >
                  {count > 9 ? "9+" : count}
                </span>
              ) : null}
            </span>
            <span aria-hidden="true" className="hidden xl:inline">
              {label}
            </span>
            {count ? (
              <span
                aria-hidden="true"
                className="ml-auto hidden rounded-full px-1.5 meta text-daylight ring-1 ring-daylight-dim tabular-nums xl:inline"
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The same destinations as a bottom bar, below the rail's breakpoint.
 *
 * Quality floor: responsive to 375px. The rails collapse; the feed becomes
 * fluid. Nothing here reflows a photograph mid-scroll.
 */
export function NavBar({
  username,
  counts,
}: {
  username: string | null;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  // No queue entries here. The bar is six wide at 375px already, and a
  // seventh target would be under the 24px floor — the pip on Messages
  // carries the same information in the room that exists.
  const items: Destination[] = [
    ...DESTINATIONS,
    ...(username
      ? [{ href: `/u/${username}`, label: "Profile", icon: UserRound }]
      : []),
  ];
  // Requests has no entry down here, so its count rides on Messages
  // alongside unread — both are one tap away through it. Activity has its
  // own entry now, so its pip belongs there rather than piled onto the same
  // dot, where "you have something" would stop saying where.
  const waitingAt: Record<string, number> = {
    "/messages": counts.requests + counts.unread,
    "/notifications": counts.activity,
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-base sm:hidden"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        const waiting = waitingAt[href] ?? 0;
        const pip = waiting > 0;
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={pip ? `${label}, ${String(waiting)} waiting` : label}
            className="flex h-14 flex-1 items-center justify-center"
          >
            <span className="relative">
              <Icon
                className={cn(
                  "size-5 transition-colors duration-[var(--duration-hover)]",
                  active ? "text-safelight" : "text-ink-dim",
                )}
                aria-hidden="true"
              />
              {pip ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-0.5 size-2 rounded-full bg-daylight ring-2 ring-base"
                />
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
