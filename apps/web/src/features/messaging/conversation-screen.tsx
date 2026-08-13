"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, Skeleton } from "@repo/ui";

import { api } from "@/lib/api";

import { Conversation } from "./conversation";
import type { Conversation as ConversationSummary } from "./inbox";

/**
 * Resolves who you are and who you are talking to, then hands off.
 *
 * Split from `Conversation` so that the thread component takes plain props
 * and can be rendered without a session — which is what makes it testable and
 * what keeps the identity fetch in exactly one place.
 */
export function ConversationScreen({
  conversationId,
}: {
  conversationId: string;
}) {
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void Promise.all([
      api.GET("/api/users/me"),
      api.GET("/api/messaging/conversations"),
    ])
      .then(([viewerResponse, conversationsResponse]) => {
        if (
          viewerResponse.data === undefined ||
          conversationsResponse.data === undefined
        ) {
          setFailed(true);
          return;
        }

        setFailed(false);
        setMissing(false);
        setViewerId(viewerResponse.data.id);
        const found = conversationsResponse.data.find(
          (item) => item.id === conversationId,
        );
        if (found === undefined) setMissing(true);
        else setSummary(found);
      })
      .catch(() => {
        setFailed(true);
      });
  }, [conversationId]);

  useEffect(load, [load]);

  if (failed) {
    return (
      <div
        role="alert"
        className="grid min-h-[calc(100dvh-9rem)] place-items-center rounded-instrument bg-panel px-6 text-center"
      >
        <div className="max-w-sm">
          <h1 className="text-2xl font-semibold text-ink">
            Conversation unavailable
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-dim">
            The thread could not be synchronized. Nothing has been deleted.
          </p>
          <Button className="mt-4" variant="secondary" onClick={load}>
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="py-12 text-center">
        <p className="text-2xl font-semibold text-ink">No such conversation</p>
        <Link
          href="/messages"
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-commit hover:text-commit-hover"
        >
          Back to messages
        </Link>
      </div>
    );
  }

  if (viewerId === null || summary === null) {
    return (
      <div
        role="status"
        aria-label="Loading conversation"
        className="flex min-h-[calc(100dvh-5rem)] flex-col sm:min-h-dvh"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-4 p-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-10 w-3/5" />
        </div>
      </div>
    );
  }

  const title =
    summary.title !== ""
      ? summary.title
      : summary.members.map((member) => member.username).join(", ");

  const names = new Map(
    summary.members.map((member) => [member.id, member.username]),
  );

  return (
    <Conversation
      key={conversationId}
      conversationId={conversationId}
      viewerId={viewerId}
      title={title}
      names={names}
      // Where everyone else had read when the thread opened. The socket takes
      // over from here; without this the first paint claims nothing has been
      // seen, and then corrects itself the moment somebody reads something.
      othersRead={summary.others_read}
      onlineNow={summary.online}
      lastSeenAt={summary.last_seen}
    />
  );
}
