import type { Metadata } from "next";

import { SignUpForm } from "@/features/auth/sign-up-form";
import { AuthFrame } from "@/features/auth/auth-frame";

export const metadata: Metadata = {
  title: "Create an account — Aperture",
};

/**
 * Same route group as sign-in, so it inherits the same absence of chrome:
 * a nav rail on a page you cannot use yet is a menu of dead ends.
 */
export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chassis px-3 py-3 sm:px-6 sm:py-8">
      <AuthFrame>
        <SignUpForm />
      </AuthFrame>
    </main>
  );
}
