import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "@/features/auth/sign-in-form";
import { AuthFrame } from "@/features/auth/auth-frame";

export const metadata: Metadata = {
  title: "Sign in — Aperture",
};

/**
 * `(auth)` has no nav chrome. That is the whole reason it is a route group
 * rather than a boolean prop on a shared layout — see `01-ARCHITECTURE.md` §2.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chassis px-3 py-3 sm:px-6 sm:py-8">
      {/* `SignInForm` reads `?next=` with `useSearchParams`, which cannot be
          known while prerendering — so without this boundary `next build`
          fails on this page rather than falling back to the client.

          The fallback is deliberately nothing. This resolves on the first
          client render, and a skeleton of a form that appears for one frame
          is more noticeable than the form simply being there. */}
      <AuthFrame>
        <Suspense
          fallback={
            <div className="h-80 animate-pulse rounded-[12px] bg-panel" />
          }
        >
          <SignInForm />
        </Suspense>
      </AuthFrame>
    </main>
  );
}
