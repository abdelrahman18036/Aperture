"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

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

  const load = useCallback(() => {
    void api.GET("/api/messaging/conversations").then((response) => {
      setLoaded(true);
      if (response.data === undefined) return;
      setConversations(response.data);
    });
  }, []);

  // Any durable event means the inbox has changed — a new message, a read
  // receipt, a deletion. Refetching the list is one cheap query and avoids
  // reimplementing the ordering rules on the client.
  const onEvent = useCallback(() => {
    load();
  }, [load]);

  useRealtimeEvents(onEvent);
  useRealtimeReady(load);

  useEffect(load, [load]);

  if (loaded && conversations.length === 0) {
    return (
      <p className="px-4 py-12 text-center font-display text-display-l text-ink-faint">
        No conversations yet
      </p>
    );
  }

  return (
    <ul aria-label="Conversations">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        const unread = conversation.unread_count;
        const other = conversation.members[0];

        return (
          <li key={conversation.id}>
            <Link
              href={`/messages/${conversation.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 border-b border-line px-4 py-3",
                "transition-colors duration-[var(--duration-hover)]",
                active ? "bg-surface" : "hover:bg-surface",
              )}
            >
              <UserAvatar
                user={other ?? { username: title(conversation) }}
                className="size-9 shrink-0"
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-ink">
                  {title(conversation)}
                </span>
                <span className="block truncate text-body text-ink-dim">
                  {conversation.last_message?.body ?? "No messages yet"}
                </span>
              </span>

              {unread > 0 && (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 meta text-daylight ring-1 ring-daylight-dim"
                  aria-label={`${String(unread)} unread`}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
