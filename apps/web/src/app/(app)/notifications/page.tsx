import type { Metadata } from "next";

import { Notifications } from "@/features/notifications/notifications";

export const metadata: Metadata = {
  title: "Activity — Aperture",
};

export default function NotificationsPage() {
  return <Notifications />;
}
