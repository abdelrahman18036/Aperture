"use client";

import { useEffect } from "react";

import { Button } from "@repo/ui";

/**
 * The error boundary.
 *
 * Without one, a thrown render error in a client component blanks the page —
 * the user gets nothing at all, which is strictly worse than a message and a
 * button. React requires this to be a client component, which is why it is
 * the only file in `app/` that says so.
 *
 * **The message is not shown.** A rendering error's text is written for
 * whoever wrote the code and routinely contains a stack, a query, or the
 * shape of something internal. It goes to the console, where a developer
 * looks, and the person reading the screen gets a sentence and a way out.
 */
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
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-display-l text-ink">Something broke</p>
      <p className="mt-4 max-w-sm text-body text-ink-dim">
        This is on us, not on you. Trying again often works — the failure is
        usually a request that did not come back.
      </p>
      {/* The digest is the one identifier that ties this screen to a server
          log, so it is worth showing even though the message is not. */}
      {error.digest !== undefined && (
        <p className="mt-4 meta">reference {error.digest}</p>
      )}
      <div className="mt-8">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
