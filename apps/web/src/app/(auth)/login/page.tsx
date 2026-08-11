import type { Metadata } from "next";

import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in — Aperture",
};

/**
 * `(auth)` has no nav chrome. That is the whole reason it is a route group
 * rather than a boolean prop on a shared layout — see `01-ARCHITECTURE.md` §2.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <SignInForm />
    </main>
  );
}
