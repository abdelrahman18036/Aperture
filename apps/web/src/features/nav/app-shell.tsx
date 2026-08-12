"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

import { NavBar, NavRail } from "./nav-rail";
import type { NavCounts } from "./nav-rail";

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
  const { viewerId } = useRealtimeApi();
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
   * What the rail's pips read from.
   *
   * Three requests on mount, and no polling — the socket carries the changes.
   */
  useEffect(() => {
    void Promise.all([
      api.GET("/api/users/requests"),
      api.GET("/api/messaging/conversations"),
      api.GET("/api/notifications/list"),
    ]).then(([requests, conversations, activity]) => {
      setCounts({
        requests: requests.data?.requests.length ?? 0,
        unread: (conversations.data ?? []).reduce(
          (total, row) => total + row.unread_count,
          0,
        ),
        activity: activity.data?.unread_count ?? 0,
      });
    });
  }, []);

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
      if (event.type !== "message.created") return;
      const message = event.payload as { sender?: { id?: string } };
      if (message.sender?.id === viewerId) return;
      if (pathname === `/messages/${event.conversation_id}`) return;

      setCounts((current) => ({ ...current, unread: current.unread + 1 }));
      void chime();
    },
    [pathname, viewerId],
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
