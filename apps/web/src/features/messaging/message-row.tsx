"use client";

import { Flag, Trash2 } from "lucide-react";

import { Button, DialogTrigger, cn } from "@repo/ui";

import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";

import type { Message } from "./use-conversation";
import type { PendingMessage } from "./use-conversation";

/**
 * One message.
 *
 * **No bubbles, and no card.** The feed's reasoning applies here too: the
 * design system allows nothing above a 2px radius and no shadow, so a chat
 * built out of rounded coloured pills would contradict the one layout
 * decision the spec calls most consequential.
 *
 * What separates you from them instead is alignment and ink weight — your
 * messages sit right against a faint surface, theirs sit left on the base.
 * Neither is accent-coloured: safelight marks *actions*, and a wall of warm
 * blocks would spend the whole accent budget on the least interesting thing
 * on screen.
 */

function formatTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    .toUpperCase();
}

export function MessageRow({
  message,
  mine,
  showSender,
  onUnsend,
}: {
  message: Message;
  mine: boolean;
  showSender: boolean;
  onUnsend: (seq: number) => void;
}) {
  return (
    <li
      className={cn(
        // `group` so the row's controls can stay hidden until it is
        // hovered or something inside it is focused. A flag against every
        // line of a conversation reads as an accusation waiting to happen;
        // one that appears when you reach for it does not.
        //
        // **Reveal-on-hover only above `sm`.** A touch screen has no hover
        // state and never fires `focus-within` from a tap, so hiding these
        // unconditionally meant a phone could not report a message, unsend
        // one, or delete a comment at all — the controls existed and were
        // permanently invisible. Below `sm` they are simply shown.
        "group flex gap-3 px-4 animate-arrive",
        mine ? "flex-row-reverse" : "flex-row",
      )}
    >
      {showSender && !mine ? (
        <UserAvatar user={message.sender} className="size-7 shrink-0" />
      ) : (
        // Holds the gutter so consecutive messages line up rather than
        // jumping left when the avatar is omitted.
        <span className={cn("size-7 shrink-0", mine && "hidden")} />
      )}

      <div className={cn("min-w-0 max-w-[75%]", mine && "text-right")}>
        {showSender && !mine && (
          <p className="meta mb-0.5">{message.sender.username}</p>
        )}
        <p
          className={cn(
            "inline-block rounded-image px-3 py-2 text-body text-ink",
            // A hairline surface, not a bubble: enough to group the words,
            // not enough to become a container.
            mine ? "bg-surface" : "bg-transparent border-b border-line",
          )}
        >
          {message.body}
        </p>
        <p className="meta mt-0.5">
          <time dateTime={message.created_at}>
            {formatTime(message.created_at)}
          </time>
          {/* The sequence number, in the role the type scale reserves for
              exactly this. It is genuinely useful when reading a thread that
              has just resynced. */}
          <span className="ml-2 opacity-60">#{message.seq}</span>
        </p>
      </div>

      {/* Only theirs. Reporting your own message is refused by the service
          anyway, and offering the control would be a small cruelty.

          §11's queue covered posts, comments, users and media but never a
          message — and harassment arrives far more often in a thread nobody
          else can see than under a public photograph. */}
      {/* Your own message is withdrawn, not reported. The endpoint has
          existed since Phase 6 and nothing called it, so there was no way to
          take back a message you had just sent. */}
      {mine ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Unsend message ${String(message.seq)}`}
          className="self-center opacity-100 transition-opacity duration-[var(--duration-hover)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => {
            onUnsend(message.seq);
          }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : (
        <ReportDialog
          subjectType="message"
          subjectId={message.id}
          trigger={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="self-center opacity-100 transition-opacity duration-[var(--duration-hover)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  aria-label={`Report this message from ${message.sender.username}`}
                />
              }
            >
              <Flag aria-hidden="true" />
            </DialogTrigger>
          }
        />
      )}
    </li>
  );
}

/**
 * A message that has been typed but not yet acknowledged.
 *
 * Dimmed rather than hidden. What you sent should be on screen the instant
 * you send it — the round trip is the thing being hidden, not the message.
 */
export function PendingRow({
  message,
  onRetry,
}: {
  message: PendingMessage;
  onRetry: (clientId: string) => void;
}) {
  return (
    <li className="flex flex-row-reverse gap-3 px-4">
      <div className="min-w-0 max-w-[75%] text-right">
        <p
          className={cn(
            "inline-block rounded-image bg-surface px-3 py-2 text-body",
            message.failed ? "text-ink-dim" : "text-ink-dim opacity-70",
          )}
        >
          {message.body}
        </p>
        {message.failed ? (
          <p className="meta mt-0.5 text-danger">
            Not sent.{" "}
            <button
              type="button"
              onClick={() => onRetry(message.client_id)}
              className="text-safelight underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : (
          <p className="meta mt-0.5">Sending</p>
        )}
      </div>
    </li>
  );
}
