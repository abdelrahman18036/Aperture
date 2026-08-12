import type { Metadata } from "next";

import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create an account — Aperture",
};

/**
 * Same route group as sign-in, so it inherits the same absence of chrome:
 * a nav rail on a page you cannot use yet is a menu of dead ends.
 */
export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <SignUpForm />
    </main>
  );
}
