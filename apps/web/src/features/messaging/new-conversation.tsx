"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Spinner,
  cn,
} from "@repo/ui";

import type { Schemas } from "@repo/api-client";

import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type Person = Schemas["User"];

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
  const [people, setPeople] = useState<Person[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  // Refetched as the field changes, so the list narrows rather than sitting
  // there as a static fifty. The endpoint caps and orders; nothing here does.
  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(() => {
      setSearchState("loading");
      void api
        .GET("/api/users/connections", {
          params: { query: draft.trim() ? { q: draft.trim() } : {} },
        })
        .then((response) => {
          if (!current) return;
          if (response.data === undefined) {
            setPeople([]);
            setSearchState("error");
            return;
          }
          setPeople(response.data?.users ?? []);
          setSearchState("ready");
        })
        .catch(() => {
          if (!current) return;
          setPeople([]);
          setSearchState("error");
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, draft]);

  // Already-picked names drop out of the list rather than appearing chosen.
  const suggestions = people.filter(
    (person) => !usernames.includes(person.username),
  );

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
    const names = [...new Set([...usernames, pending].filter(Boolean))];
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
        setOpen(false);
      })
      .catch(() => {
        setBusy(false);
        setError("That conversation could not be started. Try again.");
      });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setSearchState("loading");
          return;
        }
        setUsernames([]);
        setDraft("");
        setTitle("");
        setError(null);
        setPeople([]);
        setSearchState("idle");
      }}
    >
      <DialogTrigger render={<Button variant="secondary" />}>
        <Plus className="size-4" aria-hidden="true" />
        New message
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Choose one person for a direct message or several for a group.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend className="sr-only">Conversation recipients</legend>

            {usernames.length > 0 ? (
              <ul
                aria-label="Selected recipients"
                className="mb-3 flex flex-wrap gap-2"
              >
                {usernames.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => {
                        setUsernames((current) =>
                          current.filter((item) => item !== name),
                        );
                      }}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-control px-3 text-label",
                        "border border-seam bg-key text-key-ink shadow-key",
                        "hover:bg-key-active",
                      )}
                      aria-label={`Remove ${name}`}
                    >
                      {name}
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <label
              htmlFor="new-conversation-name"
              className="text-label text-ink"
            >
              Add people
            </label>
            <Input
              id="new-conversation-name"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSearchState("loading");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addName();
                }
              }}
              placeholder="Search people you follow"
              autoComplete="off"
              className="mt-2"
              aria-describedby="recipient-search-status"
            />

            {/* The people you follow, mutuals first, filtered as you type.
            Typing a username from memory still works — but requiring it
            meant knowing how somebody spells themselves before you could
            message them. */}
            <div
              id="recipient-search-status"
              aria-live="polite"
              className="min-h-6"
            >
              {searchState === "loading" ? (
                <p className="mt-2 flex items-center gap-2 text-body text-ink-dim">
                  <Spinner label="Searching people" />
                  Searching
                </p>
              ) : searchState === "error" ? (
                <p className="mt-2 text-body text-danger" role="alert">
                  People could not be loaded. You can still enter an exact
                  username.
                </p>
              ) : searchState === "ready" && suggestions.length === 0 ? (
                <p className="mt-2 text-body text-ink-dim">
                  No matching connections.
                </p>
              ) : null}
            </div>

            {suggestions.length > 0 ? (
              <ul
                aria-label="People you follow"
                className="mt-2 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2"
              >
                {suggestions.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setUsernames((current) =>
                          current.includes(person.username)
                            ? current
                            : [...current, person.username],
                        );
                        setDraft("");
                      }}
                      className="flex min-h-14 w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-key-active"
                    >
                      <UserAvatar user={person} className="size-8 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-body text-ink">
                          {person.username}
                        </span>
                        {person.display_name ? (
                          <span className="block truncate text-label text-ink-dim">
                            {person.display_name}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {usernames.length > 1 ? (
              <div className="mt-3">
                <label
                  htmlFor="new-conversation-title"
                  className="text-label text-ink"
                >
                  Group name <span className="text-ink-dim">(optional)</span>
                </label>
                <Input
                  id="new-conversation-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-2"
                  autoComplete="off"
                />
              </div>
            ) : null}

            {error !== null ? (
              <p className="mt-3 text-body text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <p className="mt-3 text-body text-ink-dim">
              {usernames.length + (draft.trim() === "" ? 0 : 1) > 1
                ? "Multiple recipients create one group conversation."
                : "One recipient opens a direct conversation."}
            </p>

            <DialogFooter className="mt-4">
              <DialogClose render={<Button type="button" variant="ghost" />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  busy ||
                  (usernames.length === 0 &&
                    draft.trim().replace(/^@/, "") === "")
                }
              >
                {busy ? <Spinner label="Starting conversation" /> : null}
                {busy ? "Starting" : "Start conversation"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
