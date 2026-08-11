import type { Metadata } from "next";

import { ProfileScreen } from "@/features/profile/profile";

export async function generateMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { title: `${username} — Aperture` };
}

/**
 * Profiles live under `/u/` rather than at the root.
 *
 * A bare `/[username]` would sit in the same segment as `/compose` and every
 * route added later, so every new page would silently become a username
 * nobody can register. The prefix costs three characters and removes a whole
 * category of collision.
 */
export default async function ProfilePage({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;
  return <ProfileScreen username={username} />;
}
