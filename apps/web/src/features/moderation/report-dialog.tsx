"use client";

import { useState } from "react";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InstrumentPanel,
  SurfaceState,
  cn,
} from "@repo/ui";

import { api } from "@/lib/api";

/**
 * The report button.
 *
 * `01-ARCHITECTURE.md` §11: "Build the report button before you build
 * stories." This is that button, and it shipped in the same phase as the
 * queue and the console behind it.
 *
 * Deliberately plain. Reporting something is not a moment for a flourish, and
 * the reasons are worded so that picking one is quick when someone is upset.
 */

const REASONS = [
  { value: "csam", label: "Child sexual abuse material" },
  { value: "violence", label: "Violence or threats" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "nudity", label: "Adult nudity or sexual activity" },
  { value: "self_harm", label: "Self-harm or suicide" },
  { value: "spam", label: "Spam or scam" },
  { value: "copyright", label: "Copyright or trademark" },
  { value: "other", label: "Something else" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export function ReportDialog({
  subjectType,
  subjectId,
  trigger,
}: {
  subjectType: "post" | "comment" | "user" | "media" | "message" | "story";
  subjectId: string;
  trigger: React.ReactNode;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason === null) return;
    setBusy(true);
    setError(null);
    const response = await api.POST("/api/moderation/reports", {
      // `note` is optional to a person and required by the generated type —
      // the serializer gives it a default, which drf-spectacular renders as
      // present-with-a-value rather than omittable. Sending "" is honest and
      // keeps the contract single-sourced.
      body: {
        subject_type: subjectType,
        subject_id: subjectId,
        reason,
        note: "",
      },
    });
    setBusy(false);
    if (response.data === undefined) {
      setError(
        response.response.status === 429
          ? "You have sent several reports recently. Try again later."
          : "The report could not be sent. Check your connection and try again.",
      );
      return;
    }
    // Shown whatever the server said. A failed report should not become an
    // argument with someone who is already having a bad time, and the one
    // failure mode that matters — being rate limited — is not their problem
    // to solve.
    setSent(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason(null);
          setSent(false);
          setError(null);
        }
      }}
    >
      {trigger}
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-2xl">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>Thank you</DialogTitle>
              <DialogDescription>
                Someone will look at this. We will not tell you what happened
                next — that is the reported account&rsquo;s business, not ours
                to share.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                Close
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report this</DialogTitle>
              <DialogDescription>What is wrong with it?</DialogDescription>
            </DialogHeader>

            <InstrumentPanel
              tone="key"
              className="grid gap-1 p-2 sm:grid-cols-2"
            >
              {REASONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setReason(option.value);
                  }}
                  className={cn(
                    "flex min-h-11 items-center rounded-[8px] border border-transparent px-3 text-left text-label",
                    "transition-colors duration-[var(--duration-hover)]",
                    reason === option.value
                      ? "border-accent text-accent"
                      : "text-ink-dim hover:border-seam-strong hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </InstrumentPanel>

            {error !== null ? (
              <SurfaceState
                variant="error"
                title="Report not sent"
                description={error}
                compact
              />
            ) : null}

            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                Cancel
              </DialogClose>
              <Button
                disabled={reason === null || busy}
                onClick={() => {
                  void submit();
                }}
              >
                {busy ? "Sending…" : "Report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
