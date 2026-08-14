import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";

import { Inbox } from "@/features/messaging/inbox";
import { NewConversation } from "@/features/messaging/new-conversation";

export const metadata: Metadata = {
  title: "Messages — Aperture",
};

export default function MessagesPage() {
  return (
    <div
      data-wide
      className="min-h-[calc(100dvh-7rem)] overflow-hidden rounded-dialog border border-seam bg-panel shadow-instrument xl:grid xl:h-[calc(100dvh-7rem)] xl:grid-cols-[23.5rem_minmax(0,1fr)]"
    >
      <aside
        aria-label="Conversation list"
        className="min-h-0 border-seam xl:border-r"
      >
        <header className="flex min-h-[5.5rem] items-center justify-between gap-4 border-b border-seam px-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink">
              Messages
            </h1>
            <p className="mt-1 text-sm text-ink-dim">Your conversations</p>
          </div>
          <NewConversation />
        </header>
        <section aria-label="Message threads">
          <Inbox />
        </section>
      </aside>

      <section className="hidden place-items-center bg-chassis px-10 text-center xl:grid">
        <div className="max-w-md">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-key-active text-commit">
            <MessageCircle
              className="size-7"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          </span>
          <h2 className="mt-6 text-3xl font-semibold tracking-[-0.03em] text-ink">
            Open a conversation
          </h2>
          <p className="mt-3 text-base leading-7 text-ink-dim">
            Select someone from the inbox to read the thread, share work, or
            start a call.
          </p>
        </div>
      </section>
    </div>
  );
}
