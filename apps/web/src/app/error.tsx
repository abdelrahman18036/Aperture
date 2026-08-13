"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, InstrumentPanel } from "@repo/ui";

import { ThemeControl } from "@/features/theme/theme-control";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("unhandled render error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-chassis p-3 sm:p-6">
      <InstrumentPanel
        tone="raised"
        className="w-full max-w-xl overflow-hidden"
      >
        <header className="flex items-center justify-between border-b border-seam px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="font-display text-sm tracking-[0.2em] text-ink"
          >
            APERTURE
          </Link>
          <ThemeControl />
        </header>
        <div className="px-5 py-10 text-center sm:px-10 sm:py-14">
          <div className="mx-auto grid size-14 place-items-center rounded-[12px] border border-danger/40 bg-danger/10 text-danger">
            <TriangleAlert className="size-6" aria-hidden="true" />
          </div>
          <p className="mt-5 text-sm font-medium text-danger">
            Something went wrong
          </p>
          <h1 className="mt-2 font-display text-display-l text-ink">
            This view could not load
          </h1>
          <p className="mx-auto mt-4 max-w-md text-body text-ink-dim">
            Your account and content are unchanged. Retry the view, or return to
            the feed if the problem continues.
          </p>
          {error.digest !== undefined ? (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              Reference {error.digest}
            </p>
          ) : null}
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Retry view
            </Button>
            <Button variant="secondary" render={<Link href="/" />}>
              Return to feed
            </Button>
          </div>
        </div>
      </InstrumentPanel>
    </main>
  );
}
