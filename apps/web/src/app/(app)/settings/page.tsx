import type { Metadata } from "next";

import { SettingsScreen } from "@/features/settings/settings";

export const metadata: Metadata = {
  title: "Settings — Aperture",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
