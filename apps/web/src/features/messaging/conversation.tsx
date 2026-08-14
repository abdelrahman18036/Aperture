"use client";

import { ChevronLeft, ImagePlus, Phone, SendHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Spinner, cn } from "@repo/ui";

import { useCallControls } from "@/features/calls/provider";
import { useMediaUpload } from "@/features/media/use-media-upload";
import { UserAvatar } from "@/features/profile/user-avatar";
import { relativeTime } from "@/lib/time";

import { MessageRow, PendingRow } from "./message-row";
import { TypingLine } from "./typing-dots";
import { useConversation } from "./use-conversation";
import type { Message } from "./use-conversation";

/**
 * One thread: history above, composer below, live in between.
 *
 * The scroll rule is the part that is easy to get wrong. Pinning to the
 * bottom unconditionally rips the page out from under someone reading back
 * through a thread the moment a message arrives, so it only auto-scrolls when
 * they were already at the bottom.
 */

type Media = Schemas["Media"];

/** How close to the bottom still counts as "at the bottom", in pixels. */
const STICK_THRESHOLD_PX = 80;

export function Conversation({
  conversationId,
  viewerId,
  title,
  names,
  othersRead,
  onlineNow,
  lastSeenAt,
}: {
  conversationId: string;
  viewerId: string;
  title: string;
  /** User id to username, for the people in this conversation. */
  names: ReadonlyMap<string, string>;
  /** Read positions as of the inbox fetch, keyed by user id. */
  othersRead: Record<string, number>;
  /** Who was online as of the inbox fetch. The socket takes over from here. */
  onlineNow: string[];
  /** When each other member was last connected, ISO strings by user id. */
  lastSeenAt: Record<string, string>;
}) {
  const {
    messages,
    pending,
    connection,
    typing,
    loading,
    loadError,
    retryLoad,
    send,
    retry,
    unsend,
    hide,
    seenUpToSeq,
    setOthersRead,
    online,
    setOnline,
    noteTyping,
    loadOlder,
    hasOlder,
  } = useConversation(conversationId, viewerId);

  useEffect(() => {
    setOthersRead(othersRead);
  }, [othersRead, setOthersRead]);

  useEffect(() => {
    setOnline(onlineNow);
  }, [onlineNow, setOnline]);

  // The call itself lives in the shell — this screen only starts one. That is
  // what lets a call keep running while you navigate away from the thread.
  const { session, busy } = useCallControls();

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Media | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement | null>(null);
  const { uploadMedia } = useMediaUpload();
  const scroller = useRef<HTMLDivElement | null>(null);
  const wasAtBottom = useRef(true);

  const noteScrollPosition = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    wasAtBottom.current = distance < STICK_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (element === null || !wasAtBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, pending, typing]);

  /**
   * The most recent moment anybody else was here.
   *
   * The maximum, not the minimum: "last seen" is about whether the thread is
   * being watched at all, and in a group the person who left most recently is
   * the honest answer to that.
   */
  const lastSeen = Object.values(lastSeenAt).reduce<string | null>(
    (latest, at) => (latest === null || at > latest ? at : latest),
    null,
  );

  /** The newest message you sent, which is the only one that shows "Seen". */
  const lastOwnSeq = messages.reduce(
    (highest, message) =>
      message.sender.id === viewerId && message.seq > highest
        ? message.seq
        : highest,
    0,
  );

  const messagesBySeq = useMemo(
    () => new Map(messages.map((message) => [message.seq, message])),
    [messages],
  );

  const attach = useCallback(
    async (file: File) => {
      setAttachError(null);
      setAttaching(true);
      const media = await uploadMedia(file);
      setAttaching(false);
      // A failure says nothing here on purpose — the attach button simply
      // stays empty, which is the state the person can act on. An error
      // about object storage is not.
      if (media !== null) setAttachment(media);
      else
        setAttachError(
          "That file could not be attached. Check the format and try again.",
        );
    },
    [uploadMedia],
  );

  /**
   * What the composer is answering, if anything.
   *
   * The whole message rather than its `seq`, so the strip above the field can
   * quote it without looking it back up — and so it still reads correctly if
   * the message it answers scrolls out of what we hold.
   */
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    send(draft, attachment?.id, replyTo?.seq ?? null);
    setDraft("");
    setAttachment(null);
    setReplyTo(null);
  }

  return (
    <section
      // Fills the viewport minus the mobile bottom bar, so the composer sits
      // on the bottom edge rather than below the fold.
      className="flex h-[calc(100dvh-9rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[28rem] flex-col bg-panel xl:h-full xl:min-h-0"
      aria-label={`Conversation with ${title}`}
    >
      <header className="flex min-h-[5.5rem] items-center justify-between border-b border-seam bg-panel px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* There was no way out of a thread except the browser's back
              button, and on mobile the rail is a bottom bar that does not
              include a way back to the inbox either. */}
          <Link
            href="/messages"
            aria-label="Back to messages"
            className="-ml-1 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-dim hover:bg-key hover:text-ink xl:hidden"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <UserAvatar user={{ username: title }} className="size-11 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
            <PresencePip
              state={connection}
              othersOnline={online.size > 0}
              group={names.size > 1}
              lastSeen={lastSeen}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {connection === "open" ? null : (
        <p
          role="status"
          className="border-b border-seam bg-key-active px-4 py-2 text-center text-xs text-commit"
        >
          {connection === "connecting"
            ? "Live updates are reconnecting. Failed sends remain available to retry."
            : "Live updates are offline. Failed sends remain available to retry."}
        </p>
      )}

      {loadError === null ? null : (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-danger/30 px-4 py-3"
        >
          <p className="text-body text-danger">{loadError}</p>
          <Button variant="secondary" onClick={retryLoad}>
            Try again
          </Button>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={noteScrollPosition}
        className="flex-1 overflow-y-auto bg-chassis py-6 sm:py-8"
      >
        {hasOlder && messages.length > 0 && (
          <div className="flex justify-center pb-4">
            <Button variant="ghost" onClick={loadOlder}>
              Earlier messages
            </Button>
          </div>
        )}

        {loading ? (
          <p className="px-4 meta">Loading</p>
        ) : loadError === null &&
          messages.length === 0 &&
          pending.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-2xl font-semibold tracking-[-0.025em] text-ink">
              Start the conversation
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-dim">
              Send a message, share a photograph, or begin a call.
            </p>
          </div>
        ) : null}

        <ul className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {messages.map((message, index) => (
            <MessageRow
              key={message.seq}
              message={message}
              mine={message.sender.id === viewerId}
              onUnsend={unsend}
              onHide={hide}
              onReply={setReplyTo}
              // What it answers, when we still hold it. `seq` is dense and
              // sorted, so this is a lookup rather than a scan — and
              // undefined is a fine answer: the row falls back to the number.
              quoted={
                message.reply_to_seq === null
                  ? undefined
                  : messagesBySeq.get(message.reply_to_seq)
              }
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

      {/* What the next message answers. Above the field rather than inside
          it, so the quote does not fight the text being typed. */}
      {replyTo === null ? null : (
        <div className="flex items-center gap-3 border-t border-line px-4 py-2">
          <span className="min-w-0 flex-1 truncate border-l border-safelight pl-2 meta">
            replying to {replyTo.sender.username}:{" "}
            {replyTo.body || "attachment"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stop replying"
            onClick={() => {
              setReplyTo(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* What is attached but not yet sent. Shown rather than implied: an
          attach button that silently arms itself is a button people press
          twice. */}
      {attachment !== null ? (
        <div className="flex items-center gap-3 border-t border-line px-4 pt-3">
          <span className="meta text-safelight">
            {attachment.kind === "video"
              ? "clip attached"
              : "photograph attached"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove attachment"
            onClick={() => {
              setAttachment(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {attachError === null ? null : (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-danger/30 px-4 py-2 text-body text-danger"
        >
          <span>{attachError}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss attachment error"
            onClick={() => {
              setAttachError(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="border-t border-seam bg-panel p-3 sm:px-5 sm:py-4"
      >
        <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={attaching}
            aria-label="Attach a photograph or clip"
            onClick={() => {
              attachInput.current?.click();
            }}
          >
            {attaching ? (
              <Spinner label="Uploading attachment" />
            ) : (
              <ImagePlus aria-hidden="true" />
            )}
          </Button>
          <input
            ref={attachInput}
            type="file"
            aria-label="Choose a photo or video to attach"
            accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so the same file can be chosen twice — otherwise a
              // retry after a failure does nothing at all.
              event.target.value = "";
              if (file) void attach(file);
            }}
          />
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
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send(draft, attachment?.id, replyTo?.seq ?? null);
                setDraft("");
                setAttachment(null);
                setReplyTo(null);
              }
            }}
            placeholder="Write a message"
            className={cn(
              "min-h-11 max-h-32 flex-1 resize-y rounded-control border border-seam bg-panel-raised px-4 py-2.5 text-body text-ink",
              // No `outline-none`. It was here, and it silently overrode the
              // global `:focus-visible` ring on the control this whole screen
              // is built around — the same mistake `Input` already had removed
              // once. The bottom border going safelight is *in addition to* the
              // ring, never instead of it.
              "placeholder:text-ink-faint focus-visible:border-focus",
            )}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={draft.trim() === "" && attachment === null}
            aria-label="Send"
          >
            <SendHorizontal className="size-4" aria-hidden="true" />
            Send
          </Button>
        </div>
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
function PresencePip({
  state,
  othersOnline,
  group,
  lastSeen,
}: {
  state: "connecting" | "open" | "offline";
  othersOnline: boolean;
  group: boolean;
  lastSeen: string | null;
}) {
  /**
   * Two facts, and only one of them was ever shown.
   *
   * This used to report the *socket* — so it read "Live" whenever your own
   * connection was open, which is always, next to a person who might have
   * been gone for a week. Presence has been in Redis since Phase 6 with
   * nothing reading it.
   *
   * Your own connection still matters, but only when it is broken: a
   * reconnecting socket cannot know who is there, so it says so instead of
   * guessing. When it is fine, the pip is about the other person.
   */
  const label =
    state !== "open"
      ? state === "connecting"
        ? "Reconnecting"
        : "Offline"
      : othersOnline
        ? group
          ? "Someone here"
          : "Online"
        : // "Away" alone says nothing about whether they left a minute ago
          // or last week, which is the only thing anybody wants from it.
          lastSeen !== null
          ? `Last seen ${relativeTime(lastSeen)}`
          : "Away";

  // Daylight is "happening now" — somebody actually being there qualifies,
  // and your own socket being open does not.
  const live = state === "open" && othersOnline;

  return (
    <span className="flex items-center gap-2 meta" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          live ? "bg-daylight" : "bg-ink-faint",
        )}
      />
      {label}
    </span>
  );
}
