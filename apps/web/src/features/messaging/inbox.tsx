"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { AnyServerEvent } from "@repo/realtime-events";

import type { Schemas } from "@repo/api-client";
import { Button, Skeleton, cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

import {
  useRealtimeEvents,
  useRealtimeReady,
} from "@/features/realtime/provider";

export type Conversation = Schemas["Conversation"];

/**
 * The inbox.
 *
 * It subscribes to the application's socket so the list stays live while you
 * are looking at it — a new message should reorder the inbox without a
 * refresh. It asks for no conversation channels of its own: durable events
 * arrive on your own channel regardless, which is exactly the property that
 * makes the gateway able to work without a database.
 *
 * The unread badge is **daylight**. It is new, and new is cool — the same
 * rule that makes the typing indicator cool and the send button warm.
 */

function title(conversation: Conversation): string {
  if (conversation.title !== "") return conversation.title;
  const names = conversation.members.map((member) => member.username);
  return names.length > 0 ? names.join(", ") : "Empty conversation";
}

export function Inbox({ activeId }: { activeId?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("");
  /**
   * Who is connected right now.
   *
   * Seeded from the payload — `online` comes down with each conversation,
   * read from the gateway's Redis keys — and then kept current by `presence`
   * events. Both halves are needed: the fetch is right at the moment it lands
   * and stale a second later, and the events say nothing about who was
   * already online when the page opened.
   */
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(() => {
    void api
      .GET("/api/messaging/conversations")
      .then((response) => {
        setLoaded(true);
        if (response.data === undefined) {
          setLoadError(true);
          return;
        }
        setLoadError(false);
        setConversations(response.data);
        setOnline(new Set(response.data.flatMap((row) => row.online)));
      })
      .catch(() => {
        setLoaded(true);
        setLoadError(true);
      });
  }, []);

  // Any durable event means the inbox has changed — a new message, a read
  // receipt, a deletion. Refetching the list is one cheap query and avoids
  // reimplementing the ordering rules on the client.
  //
  // A `presence` event is different in kind: nothing about the list changed,
  // only a dot on it, so it moves one entry in a set rather than costing a
  // request. The shell subscribes this socket to every conversation, which is
  // what makes these arrive at all when somebody is online but not in a
  // thread with you on screen.
  const onEvent = useCallback(
    (event: AnyServerEvent) => {
      if (event.type === "presence") {
        setOnline((current) => {
          const next = new Set(current);
          if (event.online) next.add(event.user_id);
          else next.delete(event.user_id);
          return next;
        });
        return;
      }
      load();
    },
    [load],
  );

  useRealtimeEvents(onEvent);
  useRealtimeReady(load);

  useEffect(load, [load]);

  if (!loaded) {
    return (
      <div role="status" aria-label="Loading conversations">
        <ul aria-hidden="true" className="divide-y divide-seam">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-4">
              <Skeleton className="size-9 rounded-full" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-48 max-w-full" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <p className="text-lg font-semibold text-ink">
          Messages are unavailable
        </p>
        <p className="text-sm text-ink-dim">
          Conversations could not be loaded. Your messages are still safe.
        </p>
        <Button variant="secondary" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  if (loaded && conversations.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-2xl font-semibold text-ink">Start a conversation</p>
        <p className="max-w-xs text-sm leading-6 text-ink-dim">
          Share a post or open a direct line with someone you follow.
        </p>
      </div>
    );
  }

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleConversations = conversations.filter((conversation) => {
    if (normalizedFilter === "") return true;
    return (
      title(conversation).toLowerCase().includes(normalizedFilter) ||
      (conversation.last_message?.body ?? "")
        .toLowerCase()
        .includes(normalizedFilter)
    );
  });

  return (
    <div>
      <div className="border-b border-seam p-3">
        <label className="relative block">
          <span className="sr-only">Filter conversations</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search messages"
            className="min-h-11 w-full rounded-control border border-seam bg-panel-raised pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-focus"
          />
        </label>
      </div>

      {visibleConversations.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-dim">
          No conversations match “{filter.trim()}”.
        </p>
      ) : null}

      <ul aria-label="Conversations">
        {visibleConversations.map((conversation) => {
          const active = conversation.id === activeId;
          const unread = conversation.unread_count;
          const other = conversation.members[0];

          return (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[76px] items-center gap-3 border-b border-seam px-4 py-3",
                  "transition-colors duration-[var(--duration-hover)]",
                  active ? "bg-key-active" : "hover:bg-key",
                )}
              >
                <span className="relative shrink-0">
                  <UserAvatar
                    user={other ?? { username: title(conversation) }}
                    className="size-11"
                  />
                  {/* Daylight, and a dot rather than a word: somebody being
                    here is happening now, and the design system puts that on
                    the cool side. A group is "somebody is here" rather than
                    a headcount — the header inside the thread is where that
                    question gets a real answer. */}
                  {conversation.members.some((member) =>
                    online.has(member.id),
                  ) ? (
                    <span
                      aria-label="Online"
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success ring-2 ring-panel"
                    />
                  ) : null}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {title(conversation)}
                    </span>
                    {conversation.last_message ? (
                      <time
                        dateTime={conversation.last_message.created_at}
                        className="shrink-0 text-[11px] text-ink-faint"
                      >
                        {relativeTime(conversation.last_message.created_at)}
                      </time>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-dim">
                      {conversation.last_message?.body ?? "No messages yet"}
                    </span>
                    {unread > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-commit px-2 text-xs font-semibold leading-5 text-commit-ink"
                        aria-label={`${String(unread)} unread`}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
