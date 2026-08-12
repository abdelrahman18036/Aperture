import type { Metadata } from "next";

import { Search } from "@/features/search/search";

export const metadata: Metadata = {
  title: "Search — Aperture",
};

export default function SearchPage() {
  return <Search />;
}
