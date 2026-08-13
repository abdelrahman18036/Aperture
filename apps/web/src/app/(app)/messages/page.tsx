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
      className="min-h-[calc(100dvh-7rem)] overflow-hidden rounded-dialog border border-seam bg-panel shadow-instrument"
    >
      <header className="flex min-h-20 items-center justify-between gap-4 border-b border-seam px-5 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink">
            Messages
          </h1>
          <p className="mt-1 hidden text-sm text-ink-dim sm:block">
            Conversations, shared work, and calls in one place.
          </p>
        </div>
        <NewConversation />
      </header>

      <div className="grid min-h-[38rem] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section
          aria-label="Message threads"
          className="border-seam xl:border-r"
        >
          <Inbox />
        </section>
        <section className="hidden place-items-center bg-panel-raised px-8 text-center xl:grid">
          <div className="max-w-sm">
            <MessageCircle
              className="mx-auto size-8 text-commit"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <h2 className="mt-5 text-2xl font-semibold tracking-[-0.025em] text-ink">
              Choose a conversation
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-dim">
              Messages open beside the inbox, so it is easy to move between
              people without losing your place.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
