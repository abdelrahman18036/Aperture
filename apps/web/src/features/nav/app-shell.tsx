"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  Compass,
  House,
  MessageCircle,
  Search,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CallProvider } from "@/features/calls/provider";
import { ComposeProvider } from "@/features/composer/compose-dialog";
import type { AnyServerEvent } from "@repo/realtime-events";

import {
  RealtimeProvider,
  useRealtimeApi,
  useRealtimeEvents,
} from "@/features/realtime/provider";
import { api } from "@/lib/api";
import { onCountsChanged } from "@/lib/counts";
import { chime, ping } from "@/lib/sounds";

import { NavBar, NavRail } from "./nav-rail";
import type { NavCounts } from "./nav-rail";

/** How long to let a burst of socket traffic settle before asking again. */
const REFRESH_DEBOUNCE_MS = 250;

/** Providers and persistent chrome for every authenticated route. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // One socket for the whole shell, and one place a call can appear. Both
    // live here rather than inside a screen because a call that only rings
    // when you are already looking at the right thread is not a call.
    <RealtimeProvider>
      <CallProvider>
        <ComposeProvider>
          <Shell>{children}</Shell>
        </ComposeProvider>
      </CallProvider>
    </RealtimeProvider>
  );
}

/**
 * The chrome, *inside* the providers.
 *
 * Split out because it consumes the socket — `useRealtimeApi` and
 * `useRealtimeEvents` both throw outside `RealtimeProvider`, and a component
 * cannot be inside a provider it renders itself.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { viewerId, setConversationIds } = useRealtimeApi();
  const [username, setUsername] = useState<string | null>(null);
  const [counts, setCounts] = useState<NavCounts>({
    requests: 0,
    unread: 0,
    activity: 0,
  });

  useEffect(() => {
    void api.GET("/api/users/me").then((response) => {
      // A 403 here means the cookie outlived its session — expired, rotated
      // by a password reset, or signed out in another tab. Middleware cannot
      // see that, because it only knows whether a cookie is *present*; this
      // is the half that catches it.
      if (
        response.response.status === 403 ||
        response.response.status === 401
      ) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setUsername(response.data?.username ?? null);
    });
  }, [router, pathname]);

  /**
   * What the rail's pips read from, and what the socket subscribes to.
   *
   * **Read back from the server rather than kept by arithmetic.** The unread
   * total was a local counter that only ever went up: it incremented on every
   * message that arrived somewhere else and nothing decremented it when you
   * read one, so the badge stayed lit until a refresh. Any fix by arithmetic
   * needs the shell to know how many were unread in the conversation you just
   * opened, which is precisely the thing the inbox already computes.
   *
   * The inbox costs the same number of queries whatever it holds, so asking
   * again is cheap — and it is the only answer that cannot drift.
   */
  const refresh = useCallback(() => {
    void Promise.all([
      api.GET("/api/users/requests"),
      api.GET("/api/messaging/conversations"),
      api.GET("/api/notifications/list"),
    ]).then(([requests, conversations, activity]) => {
      const rows = conversations.data ?? [];
      setCounts({
        requests: requests.data?.requests.length ?? 0,
        unread: rows.reduce((total, row) => total + row.unread_count, 0),
        activity: activity.data?.unread_count ?? 0,
      });
      // Every conversation, not just the open one. This is what makes
      // presence live: the gateway announces an arrival to the channels a
      // socket named, so a socket that named only the thread on screen
      // learned about somebody coming online only if they happened to open
      // the same thread. See `setConversationIds` in `use-realtime.ts`.
      setConversationIds(rows.map((row) => row.id));
    });
  }, [setConversationIds]);

  useEffect(refresh, [refresh]);

  // Answering your own queue produces no socket event — nothing happened
  // that anybody else needed telling about — so the screen says so.
  useEffect(() => onCountsChanged(refresh), [refresh]);

  /**
   * Ask again, once, after a burst.
   *
   * A read receipt and the message that provoked it arrive within a few
   * milliseconds of each other, and a room of four people talking is a burst
   * rather than an event. One trailing call per burst keeps the badge honest
   * without turning the socket into a polling loop.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A plain callback, not `useEffectEvent`: this is called from an event
  // handler, and an effect event may only be called from an effect or another
  // effect event. The ref is written inside the handler rather than during
  // render, which is the rule that actually matters here.
  const refreshSoon = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  }, [refresh]);
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );

  /**
   * Opening the activity page is what marks it read.
   *
   * The shell owns this rather than the page, because the shell owns the
   * number in the rail. Two owners would mean the page telling the server and
   * the rail guessing, and the guess would be wrong every time a notification
   * arrived between the two.
   */
  useEffect(() => {
    if (pathname !== "/notifications") return;
    void api.POST("/api/notifications/read").then(() => {
      setCounts((current) => ({ ...current, activity: 0 }));
    });
  }, [pathname]);

  /**
   * A message arrived somewhere.
   *
   * The count moves for any conversation that is not the one on screen, and
   * a sound plays for the same set. Chiming for the thread somebody is
   * already reading is the thing every chat app gets wrong once: they can see
   * it, and the noise is pure interruption.
   *
   * Your own messages are ignored — you know.
   */
  const onEvent = useCallback(
    (event: AnyServerEvent) => {
      if (event.type === "notification.created") {
        // A softer sound than a message, and none at all while the activity
        // page is open — you are already looking at it. A like is the least
        // urgent thing that happens here and it should not sound like a
        // message that wants an answer.
        if (pathname !== "/notifications") void ping();
        setCounts((current) =>
          pathname === "/notifications"
            ? current
            : { ...current, activity: current.activity + 1 },
        );
        return;
      }
      // A read receipt is the other half of the count and the half that was
      // missing. Your own tells you what you just did — and is exactly when
      // the badge should come down.
      if (event.type === "message.read") {
        refreshSoon();
        return;
      }

      if (event.type !== "message.created") return;
      refreshSoon();

      const message = event.payload as { sender?: { id?: string } };
      if (message.sender?.id === viewerId) return;
      if (pathname === `/messages/${event.conversation_id}`) return;

      void chime();
    },
    [pathname, refreshSoon, viewerId],
  );
  useRealtimeEvents(onEvent);

  const wideContent =
    pathname === "/explore" ||
    pathname === "/search" ||
    pathname.startsWith("/p/");

  return (
    <div className="min-h-dvh bg-chassis text-ink">
      <NavRail username={username} counts={counts} />
      <NavBar username={username} counts={counts} />

      <div className="lg:ml-64">
        <DesktopTopBar
          username={username}
          counts={counts}
          pathname={pathname}
        />
        <div className="mx-auto flex w-full max-w-[1480px] min-w-0 gap-7 px-3 py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-6 lg:px-7 lg:pb-8">
          <main
            className={
              pathname.startsWith("/messages")
                ? "min-w-0 flex-1"
                : wideContent
                  ? "mx-auto min-w-0 w-full max-w-[1160px]"
                  : "mx-auto min-w-0 w-full max-w-[800px]"
            }
          >
            {children}
          </main>
          <RightRail pathname={pathname} counts={counts} />
        </div>
      </div>
    </div>
  );
}

function DesktopTopBar({
  username,
  counts,
  pathname,
}: {
  username: string | null;
  counts: NavCounts;
  pathname: string;
}) {
  const links = [
    { href: "/", label: "Home", icon: House, count: 0 },
    { href: "/explore", label: "Explore", icon: Compass, count: 0 },
    {
      href: "/notifications",
      label: "Activity",
      icon: Bell,
      count: counts.activity,
    },
    {
      href: "/messages",
      label: "Messages",
      icon: MessageCircle,
      count: counts.unread,
    },
  ];
  return (
    <header className="sticky top-0 z-30 hidden h-[72px] items-center border-b border-seam bg-panel/95 px-7 backdrop-blur-lg lg:flex">
      <Link
        href="/search"
        className="flex h-11 w-64 items-center gap-3 rounded-control bg-key px-4 text-sm text-ink-dim transition-colors hover:bg-key-active hover:text-ink"
      >
        <Search className="size-4" aria-hidden="true" />
        Search
      </Link>
      <nav
        aria-label="Quick navigation"
        className="mx-auto flex h-full items-center gap-5"
      >
        {links.map(({ href, label, icon: Icon, count }) => {
          const active =
            href === "/"
              ? pathname === "/" || pathname.startsWith("/p/")
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-label={count ? `${label}, ${String(count)}` : label}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative grid h-full w-12 place-items-center text-commit after:absolute after:bottom-0 after:h-0.5 after:w-9 after:rounded-full after:bg-commit"
                  : "relative grid h-full w-12 place-items-center text-ink-dim transition-colors hover:text-ink"
              }
            >
              <Icon
                className="size-5"
                strokeWidth={active ? 2.3 : 1.8}
                aria-hidden="true"
              />
              {count > 0 ? (
                <span className="absolute right-1.5 top-3.5 size-2 rounded-full bg-commit ring-2 ring-panel" />
              ) : null}
            </Link>
          );
        })}
      </nav>
      <Link
        href={username ? `/u/${username}` : "/settings"}
        className="flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-key"
      >
        <span className="grid size-9 place-items-center rounded-full bg-key text-ink-dim">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
        <span className="hidden max-w-24 truncate text-sm font-medium text-ink xl:block">
          {username ?? "Profile"}
        </span>
      </Link>
    </header>
  );
}

function RightRail({
  pathname,
  counts,
}: {
  pathname: string;
  counts: NavCounts;
}) {
  if (
    pathname.startsWith("/messages") ||
    pathname === "/explore" ||
    pathname === "/search" ||
    pathname.startsWith("/p/")
  )
    return null;

  const signals = [
    {
      href: "/messages",
      label: "Unread messages",
      count: counts.unread,
      icon: MessageCircle,
    },
    {
      href: "/notifications",
      label: "New activity",
      count: counts.activity,
      icon: Bell,
    },
    {
      href: "/requests",
      label: "Follow requests",
      count: counts.requests,
      icon: UserRound,
    },
  ];

  return (
    <aside
      aria-label="At a glance"
      className="sticky top-24 hidden h-fit w-80 shrink-0 space-y-4 2xl:block"
    >
      <section className="rounded-instrument border border-seam bg-panel p-5 shadow-instrument">
        <h2 className="text-base font-semibold text-ink">At a glance</h2>
        <div className="mt-4 grid gap-2">
          {signals.map((signal) => {
            const Icon = signal.icon;
            return (
              <Link
                key={signal.href}
                href={signal.href}
                aria-current={
                  pathname === signal.href ||
                  pathname.startsWith(`${signal.href}/`)
                    ? "page"
                    : undefined
                }
                className="flex min-h-12 items-center gap-3 rounded-control px-3 text-sm text-ink-dim transition-colors hover:bg-key hover:text-ink aria-[current=page]:bg-key-active aria-[current=page]:text-commit"
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1">{signal.label}</span>
                <span className="min-w-6 rounded-full bg-key-active px-1.5 text-center text-xs font-semibold leading-6 text-commit">
                  {signal.count}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
      <section className="rounded-instrument border border-seam bg-panel p-5 shadow-instrument">
        <h2 className="text-base font-semibold text-ink">Discover more</h2>
        <p className="mt-2 text-sm leading-6 text-ink-dim">
          Find photographers, visual stories, and new work selected by the
          community.
        </p>
        <Link
          href="/explore"
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-commit transition-colors hover:text-commit-hover"
        >
          Open Explore
        </Link>
      </section>
    </aside>
  );
}
