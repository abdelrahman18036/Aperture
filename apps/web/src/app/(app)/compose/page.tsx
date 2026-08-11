import type { Metadata } from "next";

import { Composer } from "@/features/composer/composer";

export const metadata: Metadata = {
  title: "Compose — Aperture",
};

/**
 * `(app)` is the authenticated shell. The three-column layout from
 * `02-DESIGN-SYSTEM.md` lands here in Phase 4 along with the nav rail; for now
 * the composer sits in the feed column's width so it is already the right size
 * when the rails arrive.
 */
export default function ComposePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-feed flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-display-l text-ink">New post</h1>
        <p className="meta">
          bytes go straight to storage · never through our server
        </p>
      </header>
      <Composer />
    </main>
  );
}
