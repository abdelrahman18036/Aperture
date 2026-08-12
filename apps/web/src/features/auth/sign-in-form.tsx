"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Sign in.
 *
 * Minimal on purpose: Phase 4 owns the real auth screens. This exists because
 * the composer needs a session, and Phase 1 shipped Django's session auth and
 * the same-origin rewrite without any way for a browser to obtain a cookie
 * through it.
 *
 * Email is the credential; the username is for profile URLs.
 */
export function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      // Seeds the CSRF cookie if this is a cold page. The endpoint sets it on
      // every response, so one round trip covers both.
      await api.GET("/api/users/me");

      const response = await api.POST("/api/users/session", {
        body: { email, password },
      });

      setBusy(false);
      if (response.data === undefined) {
        setError("Email or password is incorrect.");
        return;
      }
      // Back where they were headed before the wall, or the feed. Only a
      // path is accepted — `next` comes from the query string, and honouring
      // a full URL there would make this an open redirect: a crafted link
      // that signs somebody in and bounces them somewhere else entirely.
      router.push(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    },
    [email, password, router, next],
  );

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex w-full max-w-sm flex-col gap-8"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-l text-ink">Aperture</h1>
        <p className="meta">sign in to upload</p>
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

      <label className="flex flex-col gap-2">
        <span className="meta">password</span>
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </label>

      {error !== null ? <p className="text-body text-danger">{error}</p> : null}

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </div>
      <p className="text-body text-ink-dim">
        <Link
          href="/reset"
          className="text-safelight underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </p>
      <p className="text-body text-ink-dim">
        No account yet?{" "}
        <Link
          href="/signup"
          className="text-safelight underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
