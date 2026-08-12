import type { Metadata } from "next";

import { ResetConfirmForm } from "@/features/auth/reset-confirm-form";

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
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <ResetConfirmForm uid={uid} token={token} />
    </main>
  );
}
