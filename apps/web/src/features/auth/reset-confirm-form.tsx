"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Set the new password, with `uid` and `token` taken from the URL.
 *
 * It does not sign you in on success, and that is not an omission. Completing
 * the reset invalidates every session the account had open — which is usually
 * the point of resetting — so the honest next step is the sign-in screen with
 * the new password, not a session quietly minted for whoever opened the link.
 *
 * The server's rejection is shown verbatim because it is the useful half:
 * "expired or already used" and "this password is too short" call for
 * completely different actions, and flattening them into "that didn't work"
 * leaves someone re-typing a password that was never the problem.
 */
export function ResetConfirmForm({ uid, token }: { uid: string; token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      await api.GET("/api/users/me");
      const response = await api.POST("/api/users/password/reset/confirm", {
        body: { uid, token, password },
      });

      setBusy(false);
      if (response.response.status === 204) {
        router.push("/login");
        return;
      }
      const detail = (response.error as { detail?: string } | undefined)?.detail;
      setError(detail ?? "That didn't work. Ask for a new link.");
    },
    [uid, token, password, router],
  );

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex w-full max-w-sm flex-col gap-8"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-l text-ink">New password</h1>
        <p className="meta">this signs your other sessions out</p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="meta">password</span>
        <Input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </label>

      {error !== null ? (
        <p className="text-body text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Set password"}
        </Button>
      </div>

      <p className="text-body text-ink-dim">
        Link expired?{" "}
        <Link
          href="/reset"
          className="text-safelight underline underline-offset-4"
        >
          Ask for another
        </Link>
      </p>
    </form>
  );
}
