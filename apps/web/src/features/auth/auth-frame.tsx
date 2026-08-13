import { Aperture } from "lucide-react";
import Link from "next/link";

import { InstrumentPanel } from "@repo/ui";

import { ThemeControl } from "@/features/theme/theme-control";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-seam bg-panel shadow-instrument lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
      <section className="relative hidden min-h-[40rem] overflow-hidden border-r border-seam bg-gradient-to-br from-accent-soft via-panel to-chassis p-12 lg:flex lg:flex-col">
        <div className="absolute -left-24 bottom-8 size-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -right-28 top-20 size-96 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <Link
            href="/login"
            className="flex items-center gap-3 text-xl font-semibold tracking-[-0.03em] text-ink"
          >
            <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-accent to-violet-400 text-white shadow-sm">
              <Aperture className="size-6" aria-hidden="true" />
            </span>
            Aperture
          </Link>
        </div>

        <div className="relative my-auto max-w-lg">
          <p className="font-display text-[clamp(2.8rem,5vw,4.8rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-ink">
            Your work,
            <br />
            in focus.
          </p>
          <p className="mt-6 max-w-md text-lg leading-8 text-ink-dim">
            Publish visual work, discover creators, and keep conversation close
            without letting the interface compete with the image.
          </p>
        </div>

        <p className="relative text-sm text-ink-faint">
          Photography, community, and conversation—without the noise.
        </p>
      </section>

      <InstrumentPanel
        tone="raised"
        className="flex min-h-[min(46rem,100dvh)] items-center rounded-none border-0 p-6 sm:p-12 lg:min-h-[40rem]"
      >
        <div className="w-full">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link
              href="/login"
              className="flex items-center gap-2 text-lg font-semibold text-ink"
            >
              <span className="grid size-9 place-items-center rounded-full bg-accent text-white">
                <Aperture className="size-5" aria-hidden="true" />
              </span>
              Aperture
            </Link>
            <ThemeControl />
          </div>
          {children}
        </div>
        <div className="absolute right-5 top-5 hidden lg:block">
          <ThemeControl />
        </div>
      </InstrumentPanel>
    </div>
  );
}
