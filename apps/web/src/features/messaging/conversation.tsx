"use client";

import { ChevronLeft, Phone, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, cn } from "@repo/ui";

import { useCallControls } from "@/features/calls/provider";

import { MessageRow, PendingRow } from "./message-row";
import { TypingLine } from "./typing-dots";
import { useConversation } from "./use-conversation";

/**
 * One thread: history above, composer below, live in between.
 *
 * The scroll rule is the part that is easy to get wrong. Pinning to the
 * bottom unconditionally rips the page out from under someone reading back
 * through a thread the moment a message arrives, so it only auto-scrolls when
 * they were already at the bottom.
 */

/** How close to the bottom still counts as "at the bottom", in pixels. */
const STICK_THRESHOLD_PX = 80;

export function Conversation({
  conversationId,
  viewerId,
  title,
  names,
  othersRead,
}: {
  conversationId: string;
  viewerId: string;
  title: string;
  /** User id to username, for the people in this conversation. */
  names: ReadonlyMap<string, string>;
  /** Read positions as of the inbox fetch, keyed by user id. */
  othersRead: Record<string, number>;
}) {
  const {
    messages,
    pending,
    connection,
    typing,
    loading,
    send,
    retry,
    unsend,
    seenUpToSeq,
    setOthersRead,
    noteTyping,
    loadOlder,
    hasOlder,
  } = useConversation(conversationId, viewerId);

  useEffect(() => {
    setOthersRead(othersRead);
  }, [othersRead, setOthersRead]);

  // The call itself lives in the shell — this screen only starts one. That is
  // what lets a call keep running while you navigate away from the thread.
  const { session, busy } = useCallControls();

  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);
  const wasAtBottom = useRef(true);

  // Before the DOM paints, note whether they were reading the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    wasAtBottom.current = distance < STICK_THRESHOLD_PX;
  });

  useEffect(() => {
    const element = scroller.current;
    if (element === null || !wasAtBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, pending, typing]);

  /** The newest message you sent, which is the only one that shows "Seen". */
  const lastOwnSeq = messages.reduce(
    (highest, message) =>
      message.sender.id === viewerId && message.seq > highest
        ? message.seq
        : highest,
    0,
  );

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    send(draft);
    setDraft("");
  }

  return (
    <section
      // Fills the viewport minus the mobile bottom bar, so the composer sits
      // on the bottom edge rather than below the fold.
      className="flex h-[calc(100dvh-5rem)] flex-col sm:h-dvh"
      aria-label={`Conversation with ${title}`}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* There was no way out of a thread except the browser's back
              button, and on mobile the rail is a bottom bar that does not
              include a way back to the inbox either. */}
          <Link
            href="/messages"
            aria-label="Back to messages"
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-dim hover:text-ink sm:hidden"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="truncate text-title text-ink">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionPip state={connection} />
          <Button
            variant="ghost"
            onClick={() => session.start(conversationId, title)}
            disabled={busy || session.starting}
            aria-label={`Call ${title}`}
          >
            <Phone className="size-4" aria-hidden="true" />
            Call
          </Button>
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto py-4">
        {hasOlder && messages.length > 0 && (
          <div className="flex justify-center pb-4">
            <Button variant="ghost" onClick={loadOlder}>
              Earlier messages
            </Button>
          </div>
        )}

        {loading ? (
          <p className="px-4 meta">Loading</p>
        ) : messages.length === 0 && pending.length === 0 ? (
          <p className="px-4 py-12 text-center font-display text-display-l text-ink-faint">
            No messages yet
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {messages.map((message, index) => (
            <MessageRow
              key={message.seq}
              message={message}
              mine={message.sender.id === viewerId}
              onUnsend={unsend}
              // Only the last of your own messages carries it. A "Seen"
              // under every line is noise; under the newest one it is the
              // single fact you wanted.
              seen={
                message.sender.id === viewerId &&
                message.seq <= seenUpToSeq &&
                message.seq === lastOwnSeq
              }
              // Group runs from the same person: repeating the avatar and
              // name on every line makes a conversation read like a list.
              showSender={messages[index - 1]?.sender.id !== message.sender.id}
            />
          ))}
          {pending.map((item) => (
            <PendingRow key={item.client_id} message={item} onRetry={retry} />
          ))}
        </ul>
      </div>

      <TypingLine
        // Ephemeral events carry ids, not names — the gateway has no database
        // to look a username up in. Resolving it here is the cost of that,
        // and it is one Map lookup against members we already hold.
        names={typing.map((id) => names.get(id) ?? "Someone")}
      />

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-line px-4 py-3"
      >
        <label htmlFor="message-body" className="sr-only">
          Message
        </label>
        <textarea
          id="message-body"
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            noteTyping();
          }}
          onKeyDown={(event) => {
            // Enter sends, shift+enter breaks the line. The other way round
            // is correct for a document and wrong for a conversation.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
              setDraft("");
            }
          }}
          placeholder="Write a message"
          className={cn(
            "min-h-9 flex-1 resize-none bg-transparent py-2 text-body text-ink",
            // No `outline-none`. It was here, and it silently overrode the
            // global `:focus-visible` ring on the control this whole screen
            // is built around — the same mistake `Input` already had removed
            // once. The bottom border going safelight is *in addition to* the
            // ring, never instead of it.
            "border-b border-line placeholder:text-ink-faint",
            "focus-visible:border-safelight",
          )}
        />
        <Button type="submit" disabled={draft.trim() === ""} aria-label="Send">
          <SendHorizontal className="size-4" aria-hidden="true" />
          Send
        </Button>
      </form>
    </section>
  );
}

/**
 * Connection state, stated rather than hidden.
 *
 * Daylight when live, because that is what daylight is for. Offline is ink
 * rather than danger red: a dropped socket is not an error, it is a state
 * that resolves itself, and colouring it red teaches people to ignore red.
 */
function ConnectionPip({ state }: { state: "connecting" | "open" | "offline" }) {
  const label =
    state === "open" ? "Live" : state === "connecting" ? "Connecting" : "Offline";

  return (
    <span className="flex items-center gap-2 meta" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          state === "open" ? "bg-daylight" : "bg-ink-faint",
        )}
      />
      {label}
    </span>
  );
}
