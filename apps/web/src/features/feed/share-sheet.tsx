"use client";

import { Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Schemas } from "@repo/api-client";
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
  cn,
} from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";
import { writeToClipboard } from "@/lib/clipboard";

type Person = Schemas["User"];

/**
 * Send a post to somebody.
 *
 * The reshare, and deliberately the *same* mechanism as a direct message
 * rather than a parallel one: it opens the conversation the two of them
 * already have, or starts one, and the post arrives as a message. There is no
 * separate "shares" inbox to check and no second unread count.
 *
 * Copying the link lives in here too, because "send this to someone" is one
 * intention with two answers — inside the product or outside it — and having
 * them as two adjacent icons made the reader choose between them before
 * knowing what either did.
 */
export function ShareSheet({
  postId,
  count,
  onShared,
}: {
  postId: string;
  count: number;
  onShared?: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  //: Set only when the clipboard refused, and holding the URL to show
  //: instead. Read inside the click handler rather than in an effect —
  //: `window` does not exist during a server render.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Narrowed server-side as the field changes, the same way the new-message
  // picker does it. Nothing here caps or orders — the endpoint owns both.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void api
        .GET("/api/users/connections", {
          params: { query: query.trim() ? { q: query.trim() } : {} },
        })
        .then((response) => {
          setPeople(response.data?.users ?? []);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query]);

  const send = useCallback(
    async (username: string) => {
      setBusy(username);
      // Two calls, because sharing to somebody you have never messaged has to
      // create the thread first. `start` returns the existing one when there
      // is one, so this does not litter.
      const started = await api.POST("/api/messaging/conversations", {
        body: { usernames: [username], title: "" },
      });
      const conversationId = started.data?.id;
      if (conversationId === undefined) {
        setBusy(null);
        return;
      }

      const sent = await api.POST(
        "/api/messaging/conversations/{conversation_id}/messages",
        {
          params: { path: { conversation_id: conversationId } },
          body: {
            client_id: crypto.randomUUID(),
            body: "",
            media_id: null,
            reply_to_seq: null,
            shared_post_id: postId,
          },
        },
      );
      setBusy(null);
      if (sent.data === undefined) return;

      setSentTo((current) => [...current, username]);
      onShared?.(count + sentTo.length + 1);
    },
    [count, onShared, postId, sentTo.length],
  );

  const copyLink = useCallback(async () => {
    // Read rather than assumed: the same component renders on localhost, on
    // 127.0.0.1 as a second signed-in session, and in a deployment.
    const url = `${window.location.origin}/p/${postId}`;
    if (await writeToClipboard(url)) {
      setCopied(true);
      return;
    }
    // The field stays until it is used. A URL that vanishes while somebody is
    // reading it is worse than no URL at all.
    setFallbackUrl(url);
  }, [postId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Send this post to someone"
            className="flex items-center gap-2 text-ink-dim transition-colors duration-[var(--duration-hover)] hover:text-ink"
          />
        }
      >
        <Send className="size-6" aria-hidden="true" />
        <span className="meta tabular-nums">{count}</span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this to</DialogTitle>
          <DialogDescription>
            It arrives as a message, in the conversation you already have.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search people"
          aria-label="Search people"
        />

        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {people.map((person) => {
            const done = sentTo.includes(person.username);
            return (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={done || busy !== null}
                  onClick={() => {
                    void send(person.username);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-control px-2 py-2 text-left",
                    "transition-colors duration-[var(--duration-hover)]",
                    done ? "text-ink-dim" : "hover:bg-raise",
                  )}
                >
                  <UserAvatar user={person} />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {person.username}
                  </span>
                  <span className="meta">
                    {done ? "sent" : busy === person.username ? "sending" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {people.length === 0 ? (
          <p className="meta py-4 text-center">nobody to send this to yet</p>
        ) : null}

        {/* When the clipboard refuses — an embedded webview, a non-secure
            origin — the URL is shown instead, selected, so it can still be
            copied by hand. */}
        {fallbackUrl === null ? null : (
          <input
            readOnly
            value={fallbackUrl}
            aria-label="Link to this post"
            ref={(node) => {
              node?.select();
            }}
            className="w-full border-b border-line bg-transparent pb-1 text-body text-ink"
          />
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              void copyLink();
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </Button>
          <DialogClose render={<Button variant="secondary" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
