import type { Metadata } from "next";

import { Explore } from "@/features/explore/explore";

export const metadata: Metadata = {
  title: "Explore — Aperture",
};

export default function ExplorePage() {
  return <Explore />;
}
