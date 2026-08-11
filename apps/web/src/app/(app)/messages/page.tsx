import type { Metadata } from "next";

import { Inbox } from "@/features/messaging/inbox";

export const metadata: Metadata = {
  title: "Messages — Aperture",
};

export default function MessagesPage() {
  return (
    <div className="py-6">
      <h1 className="px-4 pb-4 font-display text-display-l text-ink">Messages</h1>
      <Inbox />
    </div>
  );
}
