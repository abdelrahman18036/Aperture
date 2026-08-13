"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, DialogTrigger, Skeleton, SurfaceState } from "@repo/ui";

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
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
        if (profileResponse.response.status === 404) setMissing(true);
        else setFailed(true);
        return;
      }
      setProfile(profileResponse.data);
      setPosts(postsResponse.data?.posts ?? []);
      setStories(storiesResponse.data ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [username, reloadKey]);

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
      <SurfaceState
        variant="empty"
        title="Account unavailable"
        description="This account may have been removed or the address may be incorrect."
        className="my-8"
      />
    );
  }

  if (failed) {
    return (
      <SurfaceState
        variant="error"
        title="Profile did not load"
        description="We couldn’t load this profile."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(false);
              setReloadKey((value) => value + 1);
            }}
          >
            Try again
          </Button>
        }
        className="my-8"
      />
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
    // `data-wide`, like explore and the queues. A contact sheet is a grid of
    // many small frames, and in the 640px feed column it was six of them with
    // a third of the window empty beside it. The feed column exists so a
    // photograph never changes size mid-scroll; nothing on this page is that
    // photograph.
    <div data-wide className="flex flex-col gap-6 px-3 py-5 sm:px-6 sm:py-8">
      <section className="rounded-instrument border border-seam bg-panel p-5 shadow-instrument sm:p-7">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
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
                className="rounded-full p-[3px] ring-2 ring-safelight ring-offset-2 ring-offset-panel"
              >
                <UserAvatar user={profile.user} className="size-20" />
              </button>
            ) : (
              <UserAvatar user={profile.user} className="size-20" />
            )}

            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {profile.user.username}
              </h1>
              {profile.user.display_name ? (
                <p className="text-body text-ink-dim">
                  {profile.user.display_name}
                </p>
              ) : null}
            </div>

            {profile.is_self ? (
              <Link
                href="/settings"
                className="ml-auto flex min-h-11 items-center rounded-full border border-seam bg-raised px-5 text-sm font-semibold text-ink transition-colors hover:border-safelight/50 hover:text-safelight"
              >
                Edit profile
              </Link>
            ) : (
              <Button
                className="ml-auto"
                variant={
                  profile.follow_state === "none" ? "primary" : "secondary"
                }
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

          <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-seam py-4 text-sm">
            <div>
              <dt className="sr-only">Posts</dt>
              <dd>
                <strong className="font-semibold text-ink">
                  {profile.post_count}
                </strong>{" "}
                <span className="text-ink-dim">posts</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Followers</dt>
              <dd>
                <strong className="font-semibold text-ink">
                  {profile.follower_count}
                </strong>{" "}
                <span className="text-ink-dim">followers</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Following</dt>
              <dd>
                <strong className="font-semibold text-ink">
                  {profile.following_count}
                </strong>{" "}
                <span className="text-ink-dim">following</span>
              </dd>
            </div>
            {profile.user.is_private ? (
              <div>
                <dt className="sr-only">Visibility</dt>
                <dd className="text-ink-dim">Private account</dd>
              </div>
            ) : null}
          </dl>

          {profile.user.bio ? (
            <p className="max-w-prose text-body text-ink">{profile.user.bio}</p>
          ) : null}
        </header>
      </section>

      {watching ? (
        <StoryViewer
          // One author, so the viewer's author-to-author advance simply has
          // nowhere to go and it closes at the end — which is right here.
          entries={[
            {
              author: profile.user,
              stories,
              all_seen: false,
              // From the start: this list is one author's live stories
              // fetched directly, and it carries no per-frame watched state
              // the way the tray's does.
              first_unseen: 0,
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
        <SurfaceState
          variant="empty"
          title="This account is private"
          description="Follow this creator to see their work."
        />
      )}
    </div>
  );
}
