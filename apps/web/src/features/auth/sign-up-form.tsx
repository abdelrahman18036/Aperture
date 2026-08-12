"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Open an account.
 *
 * Until this existed the only way to get into the product was
 * `manage.py createsuperuser`, which makes it a demo rather than an
 * application.
 *
 * **The server's message is shown verbatim** rather than replaced with a
 * generic one, and that is the opposite of the choice `SignInForm` makes.
 * Sign-in has to stay vague because a specific answer tells an attacker which
 * emails exist; registration has to be specific because "that did not work"
 * gives someone no way to pick a username that will. `users.services.register`
 * is where the line is drawn: a taken username is named, a taken email is
 * not.
 */
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

      // Seeds the CSRF cookie on a cold page, the same way sign-in does.
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
      // Registering signs you in, so there is somewhere to go.
      router.push("/");
    },
    [email, username, password, router],
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
        <p className="meta">open an account</p>
      </div>

      <fieldset disabled={busy} className="flex flex-col gap-6">
        <legend className="sr-only">Create an account</legend>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-email" className="text-label text-ink-dim">
            Email
          </label>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-username" className="text-label text-ink-dim">
            Username
          </label>
          <Input
            id="signup-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
          <p className="meta">letters, numbers, underscores and dots</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-password" className="text-label text-ink-dim">
            Password
          </label>
          <Input
            id="signup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="meta">at least eight characters</p>
        </div>

        {error !== null && (
          <p className="text-body text-danger" role="alert">
            {error}
          </p>
        )}

        <Button type="submit">Create account</Button>
      </fieldset>

      <p className="text-body text-ink-dim">
        Already have one?{" "}
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
