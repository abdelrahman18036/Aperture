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
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  // The heading has to know the mode too. It said "New post" while the
  // button beneath it said "Add to story", which is the page telling you two
  // different things about what is about to happen.
  const toStory = (await searchParams).to === "story";

  return (
    <section className="mx-auto flex min-h-dvh max-w-feed flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-display-l text-ink">
          {toStory ? "New story" : "New post"}
        </h1>
        <p className="meta">
          {toStory
            ? "gone in 24 hours · bytes go straight to storage"
            : "bytes go straight to storage · never through our server"}
        </p>
      </header>
      <Composer />
    </section>
  );
}
