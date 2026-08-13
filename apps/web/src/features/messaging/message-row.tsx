"use client";

import { EyeOff, Flag, Info, Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Button,
  DevelopImage,
  DevelopVideo,
  DialogTrigger,
  cn,
} from "@repo/ui";

import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { relativeTime } from "@/lib/time";

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
  onHide,
  onReply,
  quoted,
  seen = false,
}: {
  message: Message;
  mine: boolean;
  showSender: boolean;
  onUnsend: (seq: number) => void;
  /** Stop seeing this one. Available on anybody's message, unlike unsend. */
  onHide: (seq: number) => void;
  onReply: (message: Message) => void;
  /** The message this one answers, when we still hold it. */
  quoted?: Message;
  /** Everyone else has read this. Only ever set on your own last message. */
  seen?: boolean;
}) {
  // Local, and deliberately not lifted: which row has its details open is
  // nobody else's business, and holding it in the conversation would mean
  // every message re-rendering when one of them is expanded.
  const [showInfo, setShowInfo] = useState(false);

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
          <p className="mb-1 text-xs font-medium text-ink-dim">
            {message.sender.username}
          </p>
        )}
        {/* What this answers. A quote rather than a jump link: the message
            being replied to is usually two rows up, and the point is to say
            *which* one, not to navigate. */}
        {message.reply_to_seq === null ? null : (
          <p
            className={cn(
              "mb-1 block truncate border-l-2 border-line pl-2 text-left meta",
              mine && "ml-auto",
            )}
          >
            {quoted === undefined
              ? `replying to #${String(message.reply_to_seq)}`
              : `${quoted.sender.username}: ${quoted.body || "attachment"}`}
          </p>
        )}

        {/* A story this answers. Their frame expires; the reply does not, so
            this falls back to saying nothing rather than to a broken chip. */}
        {message.replied_story === null ? null : (
          <p className={cn("mb-1 meta", mine && "text-right")}>
            replied to a story
          </p>
        )}

        {/* A post somebody sent into the thread. Rendered as a link with its
            own thumbnail rather than as a full post: a conversation is not a
            feed, and a photograph at feed size would take the thread over. */}
        {message.shared_post === null ? null : (
          <Link
            href={`/p/${message.shared_post.id}`}
            className="mb-1 flex w-64 max-w-full items-center gap-3 overflow-hidden rounded-image border border-line p-2 text-left transition-colors duration-[var(--duration-hover)] hover:border-ink-faint"
          >
            {/* A plain `img` and no develop-in, for the same reason the
                activity list uses one: a 40px pointer to a post is not a
                photograph being presented. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                message.shared_post.media[0]?.sources.at(-1)?.url ??
                message.shared_post.media[0]?.original_url ??
                ""
              }
              alt=""
              className="size-10 shrink-0 rounded-image object-cover"
            />
            <span className="flex min-w-0 flex-col">
              <span className="meta">
                {message.shared_post.author.username}
              </span>
              <span className="truncate text-body text-ink">
                {message.shared_post.caption || "a photograph"}
              </span>
            </span>
          </Link>
        )}

        {/* An attachment, when there is one. `Message.media` has been on
            the model and in the send payload since Phase 6 and nothing ever
            set it or drew it — a photograph could be attached by an API
            client and would render as an empty message. */}
        {message.media ? (
          /* An explicit width, because neither side of this has one
             otherwise: the bubble shrink-wraps to its content and
             `DevelopImage` sizes itself from its parent and an aspect ratio.
             Together that resolved to 59px — a photograph rendered as a
             thumbnail of itself. */
          <span className="mb-1 block w-64 max-w-full overflow-hidden rounded-image">
            {message.media.kind === "video" ? (
              <DevelopVideo
                src={
                  message.media.video_url ?? message.media.original_url ?? ""
                }
                width={message.media.width ?? 16}
                height={message.media.height ?? 9}
                blurhash={message.media.blurhash}
                durationMs={message.media.duration_ms}
                label={message.media.alt_text}
                // 256px in a thread: timecodes and a fullscreen button do
                // not fit, and are not what anybody wants from a clip in a
                // conversation.
                compact
              />
            ) : message.media.width && message.media.height ? (
              <DevelopImage
                src={
                  message.media.sources.at(-1)?.url ??
                  message.media.original_url ??
                  ""
                }
                sources={message.media.sources}
                alt={message.media.alt_text}
                width={message.media.width}
                height={message.media.height}
                blurhash={message.media.blurhash}
                dominantColor={message.media.dominant_color}
                sizes="256px"
              />
            ) : null}
          </span>
        ) : null}

        {message.body ? (
          <p
            className={cn(
              "inline-block rounded-[16px] px-4 py-2.5 text-sm leading-6",
              mine
                ? "rounded-br-md bg-commit text-commit-ink shadow-key"
                : "rounded-bl-md border border-seam bg-panel text-ink",
            )}
          >
            {message.body}
          </p>
        ) : null}
        <p className="mt-1 text-[10px] text-ink-faint">
          <time dateTime={message.created_at}>
            {formatTime(message.created_at)}
          </time>
          {/* The sequence number, in the role the type scale reserves for
              exactly this. It is genuinely useful when reading a thread that
              has just resynced. */}
          <span className="ml-2 opacity-60">#{message.seq}</span>
          {/* Daylight, not safelight. Someone else reading your message is
              something happening now rather than something you did, and the
              design system puts that on the cool side. */}
          {seen ? <span className="ml-2 text-commit">seen</span> : null}
          <button
            type="button"
            onClick={() => {
              setShowInfo((current) => !current);
            }}
            aria-expanded={showInfo}
            aria-label={`Details for message ${String(message.seq)}`}
            className="-my-4 ml-0 inline-flex size-11 items-center justify-center align-middle text-ink-dim transition-colors duration-[var(--duration-hover)] hover:text-ink"
          >
            <Info className="inline size-3" aria-hidden="true" />
          </button>
        </p>

        {/* When it was sent, and whether it has been read. Behind a toggle
            rather than always on: a thread where every line carries two
            timestamps is a log file, not a conversation. */}
        {showInfo ? (
          <dl
            className={cn(
              "mt-1 flex flex-col gap-0.5 meta",
              mine && "items-end",
            )}
          >
            <div className="flex gap-2">
              <dt>sent</dt>
              <dd className="text-ink-dim">
                {new Date(message.created_at).toLocaleString("en-GB")}
                {" · "}
                {relativeTime(message.created_at)}
              </dd>
            </div>
            {mine ? (
              <div className="flex gap-2">
                <dt>seen</dt>
                <dd className={seen ? "text-daylight" : "text-ink-dim"}>
                  {seen ? "yes" : "not yet"}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {/* Only theirs. Reporting your own message is refused by the service
          anyway, and offering the control would be a small cruelty.

          §11's queue covered posts, comments, users and media but never a
          message — and harassment arrives far more often in a thread nobody
          else can see than under a public photograph. */}
      {/* Your own message is withdrawn, not reported. The endpoint has
          existed since Phase 6 and nothing called it, so there was no way to
          take back a message you had just sent. */}
      <div
        className={cn(
          "flex self-center opacity-100 transition-opacity duration-[var(--duration-hover)]",
          "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reply to message ${String(message.seq)}`}
          onClick={() => {
            onReply(message);
          }}
        >
          <Reply aria-hidden="true" />
        </Button>

        {/* Two deletions, two controls. "Delete for me" is on every message
            including your own — you may want a photograph out of your own
            history without taking it back from the person you sent it to —
            and "unsend" is only ever on yours, because it changes what
            somebody else can see. Collapsing them into one control with a
            confirmation is how people unsend things they meant to hide. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete message ${String(message.seq)} for you only`}
          onClick={() => {
            onHide(message.seq);
          }}
        >
          <EyeOff aria-hidden="true" />
        </Button>

        {mine ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Unsend message ${String(message.seq)}`}
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
                    aria-label={`Report this message from ${message.sender.username}`}
                  />
                }
              >
                <Flag aria-hidden="true" />
              </DialogTrigger>
            }
          />
        )}
      </div>
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
            "inline-block rounded-[16px] rounded-br-md bg-key-active px-4 py-2.5 text-sm",
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
