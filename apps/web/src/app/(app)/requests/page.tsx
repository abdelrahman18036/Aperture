import type { Metadata } from "next";

import { Requests } from "@/features/requests/requests";

export const metadata: Metadata = {
  title: "Requests — Aperture",
};

export default function RequestsPage() {
  return <Requests />;
}
