"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

export function ResetRequestForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      await api.GET("/api/users/me");
      const response = await api.POST("/api/users/password/reset", {
        body: { email },
      });
      setBusy(false);
      if (response.response.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
        return;
      }
      setSent(true);
    },
    [email],
  );

  if (sent) {
    return (
      <div
        className="mx-auto flex w-full max-w-md flex-col gap-6"
        role="status"
      >
        <p className="text-sm font-medium text-accent">Reset link requested</p>
        <h1 className="font-display text-display-l text-ink">
          Check your inbox
        </h1>
        <p className="text-body text-ink-dim">
          If that address has an account, a reset link is on its way. It works
          once and expires in two hours.
        </p>
        <Link
          href="/login"
          className="min-h-11 content-center text-body text-ink underline decoration-seam-strong underline-offset-4"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col gap-7"
    >
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-display-l text-ink">Reset password</h1>
        <p className="text-body text-ink-dim">
          Enter your account email. If it matches, we will send a one-use link.
        </p>
      </div>

      <label className="flex flex-col gap-2" htmlFor="reset-email">
        <span className="text-label text-ink">Email</span>
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          aria-invalid={error !== null}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      {error !== null ? (
        <p
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        disabled={busy}
        className="w-full"
      >
        {busy ? "Sending..." : "Send reset link"}
      </Button>

      <p className="border-t border-seam pt-5 text-body text-ink-dim">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-ink underline decoration-seam-strong underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
