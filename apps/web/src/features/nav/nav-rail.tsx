"use client";

import { Camera, Compass, House, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@repo/ui";

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
}

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Feed", icon: House },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/compose", label: "New post", icon: Camera },
];

export function NavRail({ username }: { username: string | null }) {
  const pathname = usePathname();

  const items: Destination[] = [
    ...DESTINATIONS,
    ...(username
      ? [{ href: `/u/${username}`, label: "Profile", icon: UserRound }]
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

      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-control px-2",
              "text-label transition-colors duration-[var(--duration-hover)]",
              active ? "text-ink" : "text-ink-dim hover:text-ink",
            )}
          >
            <Icon
              className={cn("size-5 shrink-0", active && "text-safelight")}
              aria-hidden="true"
            />
            <span className="hidden xl:inline">{label}</span>
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
export function NavBar({ username }: { username: string | null }) {
  const pathname = usePathname();
  const items: Destination[] = [
    ...DESTINATIONS,
    ...(username
      ? [{ href: `/u/${username}`, label: "Profile", icon: UserRound }]
      : []),
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-base sm:hidden"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className="flex h-14 flex-1 items-center justify-center"
          >
            <Icon
              className={cn(
                "size-5 transition-colors duration-[var(--duration-hover)]",
                active ? "text-safelight" : "text-ink-dim",
              )}
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </nav>
  );
}
