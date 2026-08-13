"use client";

import {
  Aperture,
  Bell,
  Compass,
  House,
  MessageCircle,
  PlusSquare,
  Search,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@repo/ui";

import { useCompose } from "@/features/composer/compose-dialog";
import { ThemeControl } from "@/features/theme/theme-control";

interface Destination {
  href: string;
  label: string;
  icon: typeof House;
}

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/search", label: "Search", icon: Search },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/notifications", label: "Activity", icon: Bell },
  { href: "/requests", label: "Requests", icon: UserPlus },
];

export interface NavCounts {
  requests: number;
  unread: number;
  activity: number;
}

function countFor(href: string, counts: NavCounts): number {
  if (href === "/messages") return counts.unread;
  if (href === "/notifications") return counts.activity;
  if (href === "/requests") return counts.requests;
  return 0;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-commit px-1.5 text-center text-[11px] font-semibold leading-5 text-commit-ink">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function NavRail({
  username,
  counts,
}: {
  username: string | null;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  const { start } = useCompose();
  const profileHref = username ? `/u/${username}` : "/settings";

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-seam bg-panel px-4 py-6 text-ink lg:flex">
      <Link
        href="/"
        aria-label="Aperture home"
        className="flex items-center gap-3 px-2"
      >
        <span className="grid size-11 place-items-center rounded-[14px] bg-commit text-commit-ink shadow-key">
          <Aperture className="size-7" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span>
          <span className="block text-xl font-bold tracking-[-0.03em]">
            Aperture
          </span>
          <span className="block text-xs text-ink-dim">
            Your work, in focus.
          </span>
        </span>
      </Link>

      <nav aria-label="Primary" className="mt-10 grid gap-1.5">
        {DESTINATIONS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const count = countFor(href, counts);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={count ? `${label}, ${String(count)}` : label}
              className={cn(
                "flex min-h-12 items-center gap-4 rounded-control px-4 text-[15px] font-medium transition-colors",
                active
                  ? "bg-key-active text-commit"
                  : "text-ink-dim hover:bg-key hover:text-ink",
              )}
            >
              <Icon
                className="size-5"
                strokeWidth={active ? 2.35 : 1.8}
                aria-hidden="true"
              />
              <span>{label}</span>
              <Badge count={count} />
            </Link>
          );
        })}
      </nav>

      <div className="my-5 h-px bg-seam" />

      <button
        type="button"
        onClick={() => start("post")}
        className="flex min-h-12 items-center gap-4 rounded-control px-4 text-[15px] font-medium text-ink-dim transition-colors hover:bg-key-active hover:text-commit"
      >
        <PlusSquare className="size-5" strokeWidth={1.8} aria-hidden="true" />
        Create post
      </button>
      <Link
        href="/settings"
        className="flex min-h-12 items-center gap-4 rounded-control px-4 text-[15px] font-medium text-ink-dim transition-colors hover:bg-key hover:text-ink"
      >
        <Settings className="size-5" strokeWidth={1.8} aria-hidden="true" />
        Settings
      </Link>

      <div className="mt-auto border-t border-seam pt-5">
        <div className="flex items-center gap-3 rounded-control px-2 py-2">
          <span className="grid size-10 place-items-center rounded-full bg-key text-ink-dim">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <Link href={profileHref} className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {username ?? "Loading profile"}
            </span>
            <span className="block text-xs text-ink-dim">View profile</span>
          </Link>
          <ThemeControl
            compact
            label="Appearance"
            className="border-0 bg-transparent p-0 shadow-none"
          />
        </div>
      </div>
    </aside>
  );
}

export function NavBar({
  username,
  counts,
}: {
  username: string | null;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  const { start } = useCompose();
  const profile: Destination = {
    href: username ? `/u/${username}` : "/settings",
    label: username ? "Profile" : "Profile loading",
    icon: UserRound,
  };
  const items = [...DESTINATIONS, profile];

  return (
    <>
      <header className="sticky top-0 z-30 flex h-[calc(4.25rem+env(safe-area-inset-top))] items-center border-b border-seam bg-panel/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg lg:hidden">
        <Link
          href="/"
          aria-label="Aperture home"
          className="mr-auto flex items-center gap-2 text-ink"
        >
          <Aperture className="size-7 text-commit" aria-hidden="true" />
          <span className="text-lg font-bold">Aperture</span>
        </Link>
        <Link
          href="/search"
          aria-label="Search"
          className="grid size-11 place-items-center rounded-full text-ink-dim hover:bg-key hover:text-ink"
        >
          <Search className="size-5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => start("post")}
          aria-label="Create post"
          className="grid size-11 place-items-center rounded-full text-ink-dim hover:bg-key-active hover:text-commit"
        >
          <PlusSquare className="size-5" aria-hidden="true" />
        </button>
        <ThemeControl
          compact
          label="Appearance"
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-seam bg-panel/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      >
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const count = countFor(href, counts);
          const unavailable = label === "Profile loading";
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-disabled={unavailable || undefined}
              tabIndex={unavailable ? -1 : undefined}
              onClick={(event) => unavailable && event.preventDefault()}
              aria-label={count ? `${label}, ${String(count)}` : label}
              className={cn(
                "relative flex min-h-14 items-center justify-center rounded-control text-ink-dim transition-colors",
                active && "bg-key-active text-commit",
                unavailable && "opacity-45",
              )}
            >
              <span className="relative">
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.3 : 1.8}
                  aria-hidden="true"
                />
                {count > 0 ? (
                  <span className="absolute -right-2.5 -top-2 min-w-4 rounded-full bg-commit px-1 text-center text-[9px] font-bold leading-4 text-commit-ink">
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
