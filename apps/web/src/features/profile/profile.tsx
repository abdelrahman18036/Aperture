"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, DialogTrigger, Skeleton } from "@repo/ui";

import { ReportDialog } from "@/features/moderation/report-dialog";
import { UserAvatar } from "@/features/profile/user-avatar";
import { useRealtimeApi } from "@/features/realtime/provider";
import { StoryViewer } from "@/features/stories/story-viewer";

import type { Schemas } from "@repo/api-client";

import type { Post } from "@/features/feed/use-feed";

type Story = Schemas["Story"];
import { api } from "@/lib/api";

import { ContactSheet } from "./contact-sheet";

/**
 * "1 FOLLOWERS" is the kind of thing that reads as unfinished, and this strip
 * is uppercased `meta` so it is impossible to miss. "following" is left alone
 * — it does not inflect.
 */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The generated type, not a hand-written copy of it.
 *
 * There was a local `interface Profile` here restating the DRF serializer
 * field by field, which `01-ARCHITECTURE.md` §3 rules out in as many words —
 * and it had already drifted: `user` was missing `avatar_url`, so the avatar
 * this component renders was invisible to the typechecker.
 */
type Profile = Schemas["Profile"];
type FollowState = Profile["follow_state"];

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
  const [blocked, setBlocked] = useState(false);
  const [stories, setStories] = useState<Story[]>([]);
  const [watching, setWatching] = useState(false);
  const { viewerId } = useRealtimeApi();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [profileResponse, postsResponse, storiesResponse] =
        await Promise.all([
          api.GET("/api/users/{username}", { params: { path: { username } } }),
          api.GET("/api/posts/by/{username}", {
            params: { path: { username } },
          }),
          api.GET("/api/stories/by/{username}", {
            params: { path: { username } },
          }),
        ]);
      if (cancelled) return;

      if (profileResponse.data === undefined) {
        setMissing(true);
        return;
      }
      setProfile(profileResponse.data);
      setPosts(postsResponse.data?.posts ?? []);
      setStories(storiesResponse.data ?? []);
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

  const toggleBlock = useCallback(async () => {
    setBusy(true);
    const response = blocked
      ? await api.DELETE("/api/users/{username}/block", {
          params: { path: { username } },
        })
      : await api.POST("/api/users/{username}/block", {
          params: { path: { username } },
        });
    setBusy(false);

    if (response.response.status === 204) {
      setBlocked(!blocked);
      // Blocking severs any follow in either direction, so the button beside
      // this one is now wrong unless it is reset too.
      setProfile((current) =>
        current === null ? current : { ...current, follow_state: "none" },
      );
    }
  }, [blocked, username]);

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
          {/* A live story turns the avatar into a way in — the ring is the
              same one the tray uses, so the two surfaces agree about what a
              warm ring means. `GET /api/stories/by/{username}` had no caller
              at all until this. */}
          {stories.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setWatching(true);
              }}
              aria-label={`Watch ${profile.user.username}'s story`}
              className="rounded-full p-[2px] ring-2 ring-safelight"
            >
              <UserAvatar user={profile.user} className="size-14" />
            </button>
          ) : (
            <UserAvatar user={profile.user} className="size-14" />
          )}

          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-display-l text-ink">
              {profile.user.username}
            </h1>
            {profile.user.display_name ? (
              <p className="text-body text-ink-dim">{profile.user.display_name}</p>
            ) : null}
          </div>

          {profile.is_self ? (
            <Link
              href="/settings"
              className="ml-auto flex h-9 items-center rounded-control border border-line px-4 text-label text-ink hover:border-ink-dim"
            >
              Edit profile
            </Link>
          ) : (
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
          )}

          {!profile.is_self && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void toggleBlock();
                }}
              >
                {blocked ? "Unblock" : "Block"}
              </Button>

              {/* Reporting an *account* rather than one of its posts is the
                  case that matters when the problem is the person: the API
                  has taken `user` since Phase 5 with nothing sending it. */}
              <ReportDialog
                subjectType="user"
                subjectId={profile.user.id}
                trigger={
                  <DialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Report ${profile.user.username}`}
                      />
                    }
                  >
                    <Flag aria-hidden="true" />
                  </DialogTrigger>
                }
              />
            </>
          )}
        </div>

        {/* The meta strip again — counts are metadata, so they are set in it. */}
        <p className="meta">
          {plural(profile.post_count, "post")} ·{" "}
          {plural(profile.follower_count, "follower")} ·{" "}
          {profile.following_count} following
          {profile.user.is_private ? " · private" : ""}
        </p>

        {profile.user.bio ? (
          <p className="max-w-prose text-body text-ink">{profile.user.bio}</p>
        ) : null}
      </header>

      {watching ? (
        <StoryViewer
          // One author, so the viewer's author-to-author advance simply has
          // nowhere to go and it closes at the end — which is right here.
          entries={[
            {
              author: profile.user,
              stories,
              all_seen: false,
              latest_at: stories[0]?.created_at ?? "",
            },
          ]}
          startAt={0}
          viewerId={viewerId}
          onClose={() => {
            setWatching(false);
          }}
        />
      ) : null}

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
