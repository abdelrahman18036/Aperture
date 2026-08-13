import type { Metadata } from "next";

import { ResetConfirmForm } from "@/features/auth/reset-confirm-form";
import { AuthFrame } from "@/features/auth/auth-frame";

export const metadata: Metadata = {
  title: "Set a new password — Aperture",
};

/**
 * The link in the mail lands here. `uid` and `token` ride in the path rather
 * than a query string so they survive being copied out of a plaintext mail
 * client, which is where a `?` gets truncated.
 */
export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ uid: string; token: string }>;
}) {
  const { uid, token } = await params;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chassis px-3 py-3 sm:px-6 sm:py-8">
      <AuthFrame>
        <ResetConfirmForm uid={uid} token={token} />
      </AuthFrame>
    </main>
  );
}
