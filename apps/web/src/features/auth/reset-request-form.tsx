"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Ask for a reset link.
 *
 * **The confirmation is deliberately vague** — "if that address has an
 * account, a link is on its way" rather than "sent" or "no such account". The
 * endpoint answers 204 either way for the same reason, and a form that said
 * "we don't know that address" would hand back the enumeration oracle the API
 * just declined to be. It costs a slightly worse message for someone who
 * mistyped their own address; it is worth it.
 */
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

      // Seeds the CSRF cookie on a cold page, the same as signing in does.
      await api.GET("/api/users/me");
      const response = await api.POST("/api/users/password/reset", {
        body: { email },
      });

      setBusy(false);
      if (response.response.status === 429) {
        // The one case worth naming: silently doing nothing here looks
        // exactly like success, and the person would keep waiting for mail.
        setError("Too many attempts. Wait a minute and try again.");
        return;
      }
      setSent(true);
    },
    [email],
  );

  if (sent) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="font-display text-display-l text-ink">Check your mail</h1>
        <p className="text-body text-ink-dim">
          If that address has an account, a reset link is on its way. It works
          once and expires in two hours.
        </p>
        <Link
          href="/login"
          className="text-body text-safelight underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex w-full max-w-sm flex-col gap-8"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-l text-ink">Reset</h1>
        <p className="meta">we&rsquo;ll mail you a link</p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="meta">email</span>
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
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
          {busy ? "Sending…" : "Send the link"}
        </Button>
      </div>

      <p className="text-body text-ink-dim">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-safelight underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
