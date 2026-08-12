"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Input, cn } from "@repo/ui";

import { api } from "@/lib/api";

/**
 * Starting a conversation, with one person or several.
 *
 * The distinction between a DM and a group is not a mode the user picks — it
 * follows from how many people they name, exactly as the API decides it. One
 * name is a DM, and the server will hand back the existing thread rather than
 * a second one; more than one is a group. Making that a toggle would be
 * offering a choice the system does not actually have.
 *
 * The same is true one layer down: a group call goes through the SFU and a
 * DM stays peer-to-peer, decided by the server from the participant count.
 * So this form is also the only thing standing between the product and its
 * group-call path — which is why it exists now rather than later.
 */
export function NewConversation() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [usernames, setUsernames] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addName(): void {
    const name = draft.trim().replace(/^@/, "");
    if (name === "") return;
    if (usernames.includes(name)) {
      setDraft("");
      return;
    }
    setUsernames((current) => [...current, name]);
    setDraft("");
    setError(null);
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();

    // Whatever is still in the field counts. Making someone press enter on the
    // last name before the button works is a trap people fall into once and
    // resent every time after.
    const pending = draft.trim().replace(/^@/, "");
    const names = pending === "" ? usernames : [...usernames, pending];
    if (names.length === 0) {
      setError("Name at least one person.");
      return;
    }

    setBusy(true);
    setError(null);

    void api
      .POST("/api/messaging/conversations", {
        body: { usernames: names, title: names.length > 1 ? title : "" },
      })
      .then((response) => {
        setBusy(false);
        if (response.data === undefined) {
          setError(
            response.response.status === 404
              ? "No account by that name."
              : "That conversation could not be started.",
          );
          return;
        }
        router.push(`/messages/${response.data.id}`);
      });
  }

  if (!open) {
    return (
      <div className="px-4 pb-4">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New conversation
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-b border-line px-4 pb-4">
      <fieldset disabled={busy}>
        <legend className="sr-only">Start a conversation</legend>

        {usernames.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {usernames.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() =>
                    setUsernames((current) =>
                      current.filter((n) => n !== name),
                    )
                  }
                  className={cn(
                    "flex items-center gap-1 rounded-control px-2 py-1 meta",
                    "text-ink ring-1 ring-line hover:ring-safelight-dim",
                  )}
                  aria-label={`Remove ${name}`}
                >
                  {name}
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="new-conversation-name" className="sr-only">
          Username
        </label>
        <Input
          id="new-conversation-name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a name rather than submitting, so a group is built by
            // typing rather than by finding a second control.
            if (event.key === "Enter") {
              event.preventDefault();
              addName();
            }
          }}
          placeholder="Username, then Enter for each"
          autoComplete="off"
        />

        {usernames.length > 0 && (
          <>
            <label htmlFor="new-conversation-title" className="sr-only">
              Group name
            </label>
            <Input
              id="new-conversation-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Group name (optional)"
              className="mt-2"
              autoComplete="off"
            />
          </>
        )}

        {error !== null && (
          <p className="mt-2 text-body text-danger" role="alert">
            {error}
          </p>
        )}

        <p className="mt-2 meta">
          {usernames.length + (draft.trim() === "" ? 0 : 1) > 1
            ? "Three or more people run through the SFU"
            : "One name starts a direct message"}
        </p>

        <div className="mt-3 flex gap-2">
          <Button type="submit">Start</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setUsernames([]);
              setDraft("");
              setTitle("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
