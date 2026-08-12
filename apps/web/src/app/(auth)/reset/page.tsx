import type { Metadata } from "next";

import { ResetRequestForm } from "@/features/auth/reset-request-form";

export const metadata: Metadata = {
  title: "Reset your password — Aperture",
};

export default function ResetPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <ResetRequestForm />
    </main>
  );
}
