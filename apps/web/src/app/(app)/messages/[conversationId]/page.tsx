import type { Metadata } from "next";

import { ConversationScreen } from "@/features/messaging/conversation-screen";
import { Inbox } from "@/features/messaging/inbox";
import { NewConversation } from "@/features/messaging/new-conversation";

export const metadata: Metadata = {
  title: "Messages — Aperture",
};

/**
 * One thread.
 *
 * The id stays a string the entire way down. It is a snowflake above 2^53, so
 * anything that turns it into a `Number` — including a well-meaning
 * `parseInt` — addresses a different row.
 */
export default async function ConversationPage({
  params,
}: PageProps<"/messages/[conversationId]">) {
  const { conversationId } = await params;
  return (
    <div
      data-wide
      className="min-h-0 overflow-hidden rounded-dialog border border-seam bg-panel shadow-instrument xl:grid xl:h-[calc(100dvh-7rem)] xl:grid-cols-[23.5rem_minmax(0,1fr)]"
    >
      <aside
        aria-label="Conversation list"
        className="hidden overflow-y-auto border-r border-seam xl:block"
      >
        <header className="flex min-h-[5.5rem] items-center justify-between gap-3 border-b border-seam px-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink">
              Messages
            </h1>
            <p className="mt-1 text-sm text-ink-dim">Your conversations</p>
          </div>
          <NewConversation />
        </header>
        <Inbox activeId={conversationId} />
      </aside>
      <ConversationScreen conversationId={conversationId} />
    </div>
  );
}
