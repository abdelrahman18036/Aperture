"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback, Button, Skeleton } from "@repo/ui";

import type { Post } from "@/features/feed/use-feed";
import { api } from "@/lib/api";

import { ContactSheet } from "./contact-sheet";

type FollowState = "none" | "pending" | "accepted";

interface Profile {
  user: { username: string; display_name: string; bio: string; is_private: boolean };
  post_count: number;
  follower_count: number;
  following_count: number;
  follow_state: FollowState;
  is_self: boolean;
  can_view_posts: boolean;
}

/**
 * A profile: header, then the contact sheet.
 *
 * Counts come from the API's counters, never computed here. The follow button
 * reads `follow_state` directly — a private account answers `pending`, and a
 * request is visibly not a follow.
 */
export function ProfileScreen({ username }: { username: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [profileResponse, postsResponse] = await Promise.all([
        api.GET("/api/users/{username}", { params: { path: { username } } }),
        api.GET("/api/posts/by/{username}", { params: { path: { username } } }),
      ]);
      if (cancelled) return;

      if (profileResponse.data === undefined) {
        setMissing(true);
        return;
      }
      setProfile(profileResponse.data as Profile);
      setPosts(postsResponse.data?.posts ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [username]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    const response =
      profile.follow_state === "none"
        ? await api.POST("/api/users/{username}/follow", {
            params: { path: { username } },
          })
        : await api.DELETE("/api/users/{username}/follow", {
            params: { path: { username } },
          });
    setBusy(false);

    if (response.data) {
      setProfile({
        ...profile,
        follow_state: response.data.follow_state as FollowState,
      });
    }
  }, [profile, username]);

  if (missing) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-display text-display-l text-ink">No such account</p>
        <p className="meta">it may never have existed</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col gap-6 py-10">
        <div className="flex items-center gap-6">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="aspect-square w-full" />
      </div>
    );
  }

  const label =
    profile.follow_state === "accepted"
      ? "Following"
      : profile.follow_state === "pending"
        ? "Requested"
        : "Follow";

  return (
    <div className="flex flex-col gap-10 py-10">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-6">
          <Avatar size="lg">
            <AvatarFallback>{profile.user.username.slice(0, 2)}</AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-display-l text-ink">
              {profile.user.username}
            </h1>
            {profile.user.display_name ? (
              <p className="text-body text-ink-dim">{profile.user.display_name}</p>
            ) : null}
          </div>

          {!profile.is_self ? (
            <Button
              className="ml-auto"
              variant={profile.follow_state === "none" ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => {
                void toggleFollow();
              }}
            >
              {label}
            </Button>
          ) : null}
        </div>

        {/* The meta strip again — counts are metadata, so they are set in it. */}
        <p className="meta">
          {profile.post_count} posts · {profile.follower_count} followers ·{" "}
          {profile.following_count} following
          {profile.user.is_private ? " · private" : ""}
        </p>

        {profile.user.bio ? (
          <p className="max-w-prose text-body text-ink">{profile.user.bio}</p>
        ) : null}
      </header>

      {profile.can_view_posts ? (
        <ContactSheet posts={posts} />
      ) : (
        <div className="flex flex-col items-center gap-3 border-t border-line py-24 text-center">
          <p className="font-display text-display-l text-ink">This account is private</p>
          <p className="meta">follow to see the contact sheet</p>
        </div>
      )}
    </div>
  );
}
