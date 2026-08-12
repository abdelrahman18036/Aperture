"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input, Skeleton, TabBar } from "@repo/ui";
import type { TabDefinition } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { useAvatarUpload } from "./use-avatar-upload";
import { api } from "@/lib/api";

/**
 * Settings: your profile, the requests waiting on you, and leaving.
 *
 * Everything here was already built on the API and simply had nowhere to be
 * clicked — `PATCH /api/users/me`, `DELETE /api/users/me`,
 * `GET /api/users/requests` and `POST /api/users/{username}/respond`. A
 * private account in particular was a dead end: you could switch it on
 * nowhere, and had you managed to, nothing in the UI could approve the
 * requests that piled up behind it.
 *
 * One column, sections separated by hairlines. No cards — the same rule the
 * feed follows, and for the same reason.
 */

interface CurrentUser {
  username: string;
  display_name: string;
  bio: string;
  is_private: boolean;
  avatar_url: string | null;
}

/** Matches `users.selectors.pending_requests_for`'s own limit. */
const REQUEST_PAGE = 50;

type Tab = "profile" | "requests" | "account";

/**
 * Three panels rather than one long scroll.
 *
 * Requests earns its own tab because it is a *queue* — a thing with a count
 * that you work through — and burying a queue at the bottom of a settings
 * page is how it stops being worked through. The badge is the point.
 */
const TABS: readonly TabDefinition<Tab>[] = [
  { id: "profile", label: "Profile" },
  { id: "requests", label: "Requests" },
  { id: "account", label: "Account" },
];

interface PendingRequest {
  follower: { username: string; display_name: string };
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line py-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-title text-ink">{title}</h2>
        {note !== undefined ? <p className="meta">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const { uploadAvatar } = useAvatarUpload();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [meResponse, requestsResponse] = await Promise.all([
        api.GET("/api/users/me"),
        api.GET("/api/users/requests"),
      ]);
      if (cancelled) return;

      if (meResponse.data === undefined) {
        router.push("/login");
        return;
      }
      const user = meResponse.data as CurrentUser;
      setMe(user);
      setDisplayName(user.display_name);
      setBio(user.bio);
      setIsPrivate(user.is_private);
      setRequests((requestsResponse.data ?? []) as PendingRequest[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setSaved(false);
      const response = await api.PATCH("/api/users/me", {
        body: { display_name: displayName, bio, is_private: isPrivate },
      });
      setBusy(false);
      if (response.data !== undefined) {
        setMe(response.data as CurrentUser);
        setSaved(true);
      }
    },
    [displayName, bio, isPrivate],
  );

  const respond = useCallback(async (username: string, accept: boolean) => {
    const response = await api.POST("/api/users/{username}/respond", {
      params: { path: { username } },
      body: { accept },
    });
    if (response.response.status === 204) {
      // Dropped locally rather than refetched: the row is gone either way,
      // and a round trip to learn that is a round trip.
      setRequests((current) =>
        current.filter((item) => item.follower.username !== username),
      );
    }
  }, []);

  const setAvatar = useCallback(async (mediaId: string) => {
    const response = await api.PATCH("/api/users/me", {
      body: { avatar_media_id: mediaId },
    });
    if (response.data === undefined) {
      const detail = (response.error as { detail?: string } | undefined)?.detail;
      setAvatarError(detail ?? "That did not save.");
      return;
    }
    setMe(response.data as CurrentUser);
    setAvatarError(null);
  }, []);

  const clearAvatar = useCallback(async () => {
    // An empty string, not an omitted field: PATCH treats absent as
    // unchanged, so there would otherwise be no way to say "remove it".
    await setAvatar("");
  }, [setAvatar]);

  const pickAvatar = useCallback(
    async (file: File) => {
      setAvatarBusy(true);
      setAvatarError(null);

      const media = await uploadAvatar(file);
      if (media === null) {
        setAvatarBusy(false);
        setAvatarError(
          "That image could not be processed. Try a different one.",
        );
        return;
      }
      await setAvatar(media.id);
      setAvatarBusy(false);
    },
    [setAvatar, uploadAvatar],
  );

  const signOut = useCallback(async () => {
    await api.DELETE("/api/users/session");
    router.push("/login");
  }, [router]);

  const deleteAccount = useCallback(async () => {
    setBusy(true);
    await api.DELETE("/api/users/me");
    router.push("/login");
  }, [router]);

  if (!me) {
    return (
      <div className="flex flex-col gap-6 py-10">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col py-10">
      <header className="flex flex-col gap-2 pb-8">
        <h1 className="font-display text-display-l text-ink">Settings</h1>
        <p className="meta">signed in as {me.username}</p>
      </header>

      <TabBar
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        badges={{ requests: requests.length }}
      />

      {tab === "profile" ? (
        <>
      <Section
        title="Avatar"
        note="a square photograph — everything else is cropped to it"
      >
        <div className="flex items-center gap-5">
          <UserAvatar user={me} className="size-14" />

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={avatarBusy}
                onClick={() => {
                  avatarInput.current?.click();
                }}
              >
                {avatarBusy ? "Uploading…" : "Choose a photograph"}
              </Button>
              {me.avatar_url !== null ? (
                <Button
                  variant="ghost"
                  disabled={avatarBusy}
                  onClick={() => {
                    void clearAvatar();
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {avatarError !== null ? (
              <p className="text-body text-danger" role="alert">
                {avatarError}
              </p>
            ) : null}
          </div>

          {/* Hidden, and driven by the button beside it: a bare file input
              cannot be styled and looks like nothing else in the product. */}
          <input
            ref={avatarInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice fires again — a
              // retry after a failure would otherwise do nothing.
              event.target.value = "";
              if (file) void pickAvatar(file);
            }}
          />
        </div>
      </Section>

      <Section title="Profile" note="what people see on your page">
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className="flex flex-col gap-6"
        >
          <label className="flex flex-col gap-2">
            <span className="meta">display name</span>
            <Input
              value={displayName}
              maxLength={60}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setSaved(false);
              }}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="meta">bio</span>
            <textarea
              value={bio}
              maxLength={300}
              rows={3}
              onChange={(event) => {
                setBio(event.target.value);
                setSaved(false);
              }}
              className="w-full resize-none border-b border-line bg-transparent pb-2 text-body text-ink placeholder:text-ink-faint focus-visible:border-safelight"
            />
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => {
                setIsPrivate(event.target.checked);
                setSaved(false);
              }}
              className="size-4 accent-safelight"
            />
            <span className="text-body text-ink">Private account</span>
            <span className="meta">new followers have to be approved</span>
          </label>

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved ? <span className="meta text-safelight">saved</span> : null}
          </div>
        </form>
      </Section>
        </>
      ) : null}

      {tab === "requests" ? (
      <Section
        title="Follow requests"
        // The API caps this at fifty, so past that the count is a floor
        // rather than a total and the copy says so instead of stating a
        // number that is wrong.
        note={
          requests.length === 0
            ? "nobody is waiting"
            : requests.length < REQUEST_PAGE
              ? `${String(requests.length)} waiting on you`
              : "the fifty most recent — answer these and more appear"
        }
      >
        <ul className="flex flex-col">
          {requests.map((request) => (
            <li
              key={request.follower.username}
              className="flex items-center gap-4 border-b border-line py-3 last:border-b-0"
            >
              <UserAvatar user={request.follower} />
              <div className="flex min-w-0 flex-col">
                <span className="text-body text-ink">
                  {request.follower.username}
                </span>
                {request.follower.display_name ? (
                  <span className="meta">{request.follower.display_name}</span>
                ) : null}
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  onClick={() => {
                    void respond(request.follower.username, true);
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void respond(request.follower.username, false);
                  }}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      ) : null}

      {tab === "account" ? (
        <>
      <Section title="Session" note="this browser only">
        <div>
          {/* There was no way to sign out at all — the endpoint has existed
              since Phase 1 and nothing ever called it. */}
          <Button
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </Section>

      <Section
        title="Delete account"
        note="your posts disappear immediately; the rows are erased after a grace period"
      >
        {confirmingDelete ? (
          <div className="flex flex-col gap-4">
            <p className="text-body text-danger" role="alert">
              This signs you out and hides everything you have posted. Within
              the grace period it can still be undone by a human; after that it
              cannot.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  void deleteAccount();
                }}
              >
                Delete it
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {/* Two steps, deliberately. This is the one control on the page
                that cannot be undone by clicking it again. */}
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              Delete my account
            </Button>
          </div>
        )}
      </Section>
        </>
      ) : null}
    </div>
  );
}
