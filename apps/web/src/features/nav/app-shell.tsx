"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

import { NavBar, NavRail } from "./nav-rail";

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

  useEffect(() => {
    void api.GET("/api/users/me").then((response) => {
      setUsername(response.data?.username ?? null);
    });
  }, []);

  return (
    <div className="min-h-dvh">
      <NavRail username={username} />
      <NavBar username={username} />

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
  );
}
