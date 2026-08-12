import Link from "next/link";

/**
 * The 404.
 *
 * Next ships a default and it is unstyled white-on-white HTML, which in a
 * dark product reads as the application having crashed rather than as a page
 * being absent. This one is the product: same base, same grain, same type.
 *
 * Display face for the number, `meta` for the explanation, and a single warm
 * link out. No illustration and no apology — a wrong address is not an error
 * anyone needs to feel bad about, and a page that performs regret about it
 * takes longer to read.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-display-xl text-ink">404</p>
      <p className="mt-2 meta">no such page</p>
      <p className="mt-6 max-w-sm text-body text-ink-dim">
        The address is wrong, or whatever was here has been deleted.
      </p>
      <Link
        href="/"
        className="mt-8 text-label text-safelight underline underline-offset-4"
      >
        Back to the feed
      </Link>
    </main>
  );
}
