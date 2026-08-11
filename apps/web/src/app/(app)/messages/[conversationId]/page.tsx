import type { Metadata } from "next";

import { ConversationScreen } from "@/features/messaging/conversation-screen";

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
  return <ConversationScreen conversationId={conversationId} />;
}
