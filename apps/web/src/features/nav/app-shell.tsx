"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CallProvider } from "@/features/calls/provider";
import { ComposeProvider } from "@/features/composer/compose-dialog";
import type { AnyServerEvent } from "@repo/realtime-events";

import {
  RealtimeProvider,
  useRealtimeApi,
  useRealtimeEvents,
} from "@/features/realtime/provider";
import { chime } from "./chime";
import { api } from "@/lib/api";
import { onCountsChanged } from "@/lib/counts";

import { NavBar, NavRail } from "./nav-rail";
import type { NavCounts } from "./nav-rail";

/** How long to let a burst of socket traffic settle before asking again. */
const REFRESH_DEBOUNCE_MS = 250;

/**
 * The three-column shell.
 *
 * Left: the nav rail, fixed. Middle: the feed column at exactly 640px,
 * centred. Right: a 320px rail, dropped below 1280px.
 *
 * The middle column is `w-feed` rather than a max-width because "fixed at
 * 640px, never fluid" is the instruction — a photograph that changes size as
 * you resize the window makes the whole page feel unstable.
 */
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
      if (response.response.status === 403 || response.response.status === 401) {
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
        // No chime. A like is not an interruption, and a sound for every one
        // of them is how an app teaches somebody to turn sound off.
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

  return (
    <div className="min-h-dvh">
      <NavRail username={username} counts={counts} />
      <NavBar username={username} counts={counts} />

      <div className="sm:pl-nav-rail xl:pl-nav-rail-open">
        <div className="app-columns mx-auto flex justify-center gap-10 px-4 pb-20 sm:pb-0">
          <main className="w-full min-w-0 sm:w-feed sm:shrink-0">{children}</main>

          <aside
            aria-label="Suggestions"
            className="hidden w-right-rail shrink-0 py-10 xl:block"
          >
            <p className="meta">suggestions</p>
            <p className="mt-3 text-body text-ink-dim">
              Follow more accounts and this fills in.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
