"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    void api.GET("/api/users/me").then((response) => {
      setViewerId(response.data?.id ?? null);
    });
  }, []);

  useEffect(() => {
    void api.GET("/api/messaging/conversations").then((response) => {
      if (response.data === undefined) return;
      const found = response.data.find((item) => item.id === conversationId);
      if (found === undefined) setMissing(true);
      else setSummary(found);
    });
  }, [conversationId]);

  if (missing) {
    return (
      <div className="py-12 text-center">
        <p className="font-display text-display-l text-ink-faint">
          No such conversation
        </p>
        <Link
          href="/messages"
          className="mt-4 inline-block text-label text-safelight"
        >
          Back to messages
        </Link>
      </div>
    );
  }

  if (viewerId === null || summary === null) {
    return <p className="px-4 py-6 meta">Loading</p>;
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
      conversationId={conversationId}
      viewerId={viewerId}
      title={title}
      names={names}
    />
  );
}
