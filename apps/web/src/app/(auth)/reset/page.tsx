import type { Metadata } from "next";

import { ResetRequestForm } from "@/features/auth/reset-request-form";
import { AuthFrame } from "@/features/auth/auth-frame";

export const metadata: Metadata = {
  title: "Reset your password — Aperture",
};

export default function ResetPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chassis px-3 py-3 sm:px-6 sm:py-8">
      <AuthFrame>
        <ResetRequestForm />
      </AuthFrame>
    </main>
  );
}
