"use client";

import { useEffect, useState } from "react";

import { CallProvider } from "@/features/calls/provider";
import { RealtimeProvider } from "@/features/realtime/provider";
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
  const [username, setUsername] = useState<string | null>(null);
  const [counts, setCounts] = useState<NavCounts>({ requests: 0, unread: 0 });

  useEffect(() => {
    void api.GET("/api/users/me").then((response) => {
      setUsername(response.data?.username ?? null);
    });
  }, []);

  /**
   * What the rail's pips read from.
   *
   * Two requests on mount, and no polling: both queues also arrive over the
   * socket while the app is open — a message event moves the unread count and
   * the requests page refetches itself. Polling a sidebar every few seconds
   * is a request per user per tick for a number that changes hourly.
   */
  useEffect(() => {
    void Promise.all([
      api.GET("/api/users/requests"),
      api.GET("/api/messaging/conversations"),
    ]).then(([requests, conversations]) => {
      setCounts({
        requests: requests.data?.requests.length ?? 0,
        unread: (conversations.data ?? []).reduce(
          (total, row) => total + row.unread_count,
          0,
        ),
      });
    });
  }, []);

  return (
    // One socket for the whole shell, and one place a call can appear. Both
    // live here rather than inside a screen because a call that only rings
    // when you are already looking at the right thread is not a call.
    <RealtimeProvider>
      <CallProvider>
        <div className="min-h-dvh">
      <NavRail username={username} counts={counts} />
      <NavBar username={username} counts={counts} />

      <div className="sm:pl-nav-rail xl:pl-nav-rail-open">
        <div className="mx-auto flex justify-center gap-10 px-4 pb-20 sm:pb-0">
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
      </CallProvider>
    </RealtimeProvider>
  );
}
