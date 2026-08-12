"use client";

import { Phone, SendHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button, cn } from "@repo/ui";

import { CallPanel } from "@/features/calls/call-panel";
import { useEventBus } from "@/features/calls/event-bus";
import { useCall } from "@/features/calls/use-call";
import { usePeerCall } from "@/features/calls/use-peer-call";
import { useSfuCall } from "@/features/calls/use-sfu-call";

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
}: {
  conversationId: string;
  viewerId: string;
  title: string;
  /** User id to username, for the people in this conversation. */
  names: ReadonlyMap<string, string>;
}) {
  // The bus breaks a genuine ordering problem: the conversation needs a call
  // handler before the call hooks — which need its `sendCallSignal` — exist.
  // Its identity never changes, so subscribers attach from effects later.
  const bus = useEventBus();

  const {
    messages,
    pending,
    connection,
    typing,
    loading,
    send,
    retry,
    noteTyping,
    loadOlder,
    hasOlder,
    sendCallSignal,
    setCallIds,
  } = useConversation(conversationId, viewerId, { onOtherEvent: bus.emit });

  const session = useCall({ conversationId, sendSignal: sendCallSignal });

  // Subscribing to the call's channel is what makes signalling reach us, and
  // it must happen before the first offer does. Driven by the call's
  // *existence* rather than its state, and by the invite as well as the call
  // itself — a callee has to be listening while they decide whether to
  // answer.
  const activeCallId = session.call?.id ?? session.incoming?.call_id ?? null;
  useEffect(() => {
    setCallIds(activeCallId === null ? [] : [activeCallId]);
  }, [activeCallId, setCallIds]);

  const peerId = useMemo(
    () =>
      session.call?.participant_ids.find((id) => id !== viewerId) ?? null,
    [session.call, viewerId],
  );

  /**
   * `?relay=1` forces every candidate through TURN.
   *
   * This phase's verification asks for exactly this, and putting it in the
   * product rather than in a one-off script means the check stays runnable:
   * a call that connects under `relay` proves the TCP/443 path works, which
   * is the path that survives a network dropping UDP.
   *
   * Harmless to leave in. It only *restricts* which candidates are tried, so
   * the worst a user can do with it is make their own call take a slower
   * route — which, on a hostile network, is sometimes what they want.
   */
  const relayOnly = useSearchParams().get("relay") === "1";

  const peer = usePeerCall({
    call: session.call,
    viewerId,
    peerId,
    sendSignal: sendCallSignal,
    relayOnly,
  });

  const sfu = useSfuCall(session.call);

  useEffect(() => bus.subscribe(session.observe), [bus, session.observe]);
  useEffect(() => bus.subscribe(peer.handleSignal), [bus, peer.handleSignal]);

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
        <h1 className="text-title text-ink">{title}</h1>
        <div className="flex items-center gap-4">
          <ConnectionPip state={connection} />
          {session.call === null && (
            <Button
              variant="ghost"
              onClick={session.start}
              disabled={session.starting}
              aria-label={`Call ${title}`}
            >
              <Phone className="size-4" aria-hidden="true" />
              Call
            </Button>
          )}
        </div>
      </header>

      {session.error !== null && (
        <p className="px-4 py-2 text-body text-danger" role="alert">
          {session.error}
        </p>
      )}

      {session.incoming !== null && (
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-body text-ink">
            {/* Daylight: something happening now, per the palette rule. */}
            <span className="text-daylight">
              {session.incoming.caller.username}
            </span>{" "}
            is calling
          </p>
          <div className="flex gap-2">
            <Button onClick={session.answer}>Answer</Button>
            <Button variant="ghost" onClick={session.decline}>
              Decline
            </Button>
          </div>
        </div>
      )}

      {session.call !== null && (
        <CallPanel
          call={session.call}
          peer={peer}
          sfu={sfu}
          peerName={title}
          onHangUp={session.hangUp}
        />
      )}

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
