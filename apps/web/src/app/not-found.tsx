import { MapPinOff } from "lucide-react";
import Link from "next/link";

import { InstrumentPanel, buttonVariants, cn } from "@repo/ui";

import { ThemeControl } from "@/features/theme/theme-control";

export default function NotFound() {
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
          <div className="mx-auto grid size-14 place-items-center rounded-full border border-seam bg-accent-soft text-accent">
            <MapPinOff className="size-6" aria-hidden="true" />
          </div>
          <p className="mt-5 text-sm font-medium text-accent">Page not found</p>
          <h1 className="mt-2 font-display text-display-l text-ink">
            This page is out of frame
          </h1>
          <p className="mx-auto mt-4 max-w-md text-body text-ink-dim">
            The address may be incorrect, or the content may have been removed.
          </p>
          <Link href="/" className={cn(buttonVariants(), "mt-7")}>
            Return to feed
          </Link>
        </div>
      </InstrumentPanel>
    </main>
  );
}
