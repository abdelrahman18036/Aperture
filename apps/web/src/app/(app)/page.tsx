import type { Metadata } from "next";

import { Feed } from "@/features/feed/feed";

export const metadata: Metadata = {
  title: "Aperture",
};

export default function FeedPage() {
  return <Feed />;
}
