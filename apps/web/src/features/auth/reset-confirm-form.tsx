"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button, Input } from "@repo/ui";

import { api } from "@/lib/api";

export function ResetConfirmForm({
  uid,
  token,
}: {
  uid: string;
  token: string;
}) {
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
      const detail = (response.error as { detail?: string } | undefined)
        ?.detail;
      setError(detail ?? "That did not work. Ask for a new link.");
    },
    [uid, token, password, router],
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col gap-7"
    >
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-display-l text-ink">
          Set a new password
        </h1>
        <p className="text-body text-ink-dim">
          Saving this password signs every other active session out.
        </p>
      </div>

      <label className="flex flex-col gap-2" htmlFor="new-password">
        <span className="text-label text-ink">New password</span>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          aria-describedby="password-requirements"
          aria-invalid={error !== null}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <p id="password-requirements" className="text-sm text-ink-faint">
        Minimum eight characters
      </p>

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
        {busy ? "Saving..." : "Set password"}
      </Button>

      <p className="border-t border-seam pt-5 text-body text-ink-dim">
        Link expired?{" "}
        <Link
          href="/reset"
          className="text-ink underline decoration-seam-strong underline-offset-4"
        >
          Ask for another
        </Link>
      </p>
    </form>
  );
}
