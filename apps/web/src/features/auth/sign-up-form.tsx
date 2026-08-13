"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      await api.GET("/api/users/me");
      const response = await api.POST("/api/users/register", {
        body: { email, username, password },
      });
      setBusy(false);
      if (response.data === undefined) {
        const detail = (response.error as { detail?: string } | undefined)
          ?.detail;
        setError(detail ?? "That account could not be created.");
        return;
      }
      router.push("/");
    },
    [email, username, password, router],
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col gap-7"
    >
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-display-l text-ink">
          Create your space
        </h1>
        <p className="text-body text-ink-dim">
          Set up the identity attached to your work and conversations.
        </p>
      </div>

      <fieldset disabled={busy} className="flex flex-col gap-5">
        <legend className="sr-only">Create an account</legend>
        <label className="flex flex-col gap-2" htmlFor="signup-email">
          <span className="text-label text-ink">Email</span>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            aria-invalid={error !== null}
            required
          />
        </label>
        <label className="flex flex-col gap-2" htmlFor="signup-username">
          <span className="text-label text-ink">Username</span>
          <Input
            id="signup-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            aria-describedby="username-requirements"
            aria-invalid={error !== null}
            required
          />
          <span id="username-requirements" className="text-sm text-ink-faint">
            Letters, numbers, underscores, and dots
          </span>
        </label>
        <label className="flex flex-col gap-2" htmlFor="signup-password">
          <span className="text-label text-ink">Password</span>
          <Input
            id="signup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            aria-describedby="signup-password-requirements"
            aria-invalid={error !== null}
            required
          />
          <span
            id="signup-password-requirements"
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint"
          >
            Minimum eight characters
          </span>
        </label>

        {error !== null ? (
          <p
            className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-body text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="w-full">
          {busy ? "Creating account..." : "Create account"}
        </Button>
      </fieldset>

      <p className="border-t border-seam pt-5 text-body text-ink-dim">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-ink underline decoration-seam-strong underline-offset-4 hover:text-ink-dim"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
