"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

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
      await api.GET("/api/users/me");
      const response = await api.POST("/api/users/session", {
        body: { email, password },
      });
      setBusy(false);
      if (response.data === undefined) {
        setError("Email or password is incorrect.");
        return;
      }
      router.push(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    },
    [email, password, router, next],
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col gap-7"
    >
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-display-l text-ink">Welcome back</h1>
        <p className="text-body text-ink-dim">
          Sign in to publish, respond, and continue your conversations.
        </p>
      </div>

      <label className="flex flex-col gap-2" htmlFor="signin-email">
        <span className="text-label text-ink">Email</span>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          aria-invalid={error !== null}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-2" htmlFor="signin-password">
        <span className="text-label text-ink">Password</span>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          aria-invalid={error !== null}
          onChange={(event) => setPassword(event.target.value)}
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
        {busy ? "Signing in..." : "Sign in"}
      </Button>

      <div className="flex flex-col gap-2 border-t border-seam pt-5 text-body text-ink-dim sm:flex-row sm:items-center sm:justify-between">
        <Link href="/reset" className="min-h-11 content-center hover:text-ink">
          Forgot password?
        </Link>
        <Link
          href="/signup"
          className="min-h-11 content-center text-ink hover:text-ink-dim"
        >
          Create account
        </Link>
      </div>
    </form>
  );
}
