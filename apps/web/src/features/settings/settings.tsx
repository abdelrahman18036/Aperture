"use client";

import {
  Camera,
  LockKeyhole,
  LogOut,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Input, InstrumentPanel, SurfaceState, TabBar } from "@repo/ui";
import type { TabDefinition } from "@repo/ui";

import { useMediaUpload } from "@/features/media/use-media-upload";
import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type CurrentUser = Schemas["CurrentUser"];
type Tab = "profile" | "account";

const TABS: readonly TabDefinition<Tab>[] = [
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account" },
];

function Section({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b border-seam px-4 py-6 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:px-6 sm:py-8">
      <div>
        <div className="flex items-center gap-2 text-ink">
          <Icon className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-title">{title}</h2>
        </div>
        <p className="mt-2 max-w-[28ch] text-label text-ink-dim">{note}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const { uploadMedia } = useMediaUpload();

  useEffect(() => {
    let cancelled = false;
    void api.GET("/api/users/me").then((response) => {
      if (cancelled) return;
      if (
        response.response.status === 401 ||
        response.response.status === 403
      ) {
        router.push("/login");
        return;
      }
      if (response.data === undefined) {
        setLoadError(true);
        return;
      }
      setMe(response.data);
      setDisplayName(response.data.display_name);
      setBio(response.data.bio);
      setIsPrivate(response.data.is_private);
    });
    return () => {
      cancelled = true;
    };
  }, [router, loadAttempt]);

  const markChanged = useCallback(() => {
    setSaved(false);
    setSaveError(null);
  }, []);

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setSaved(false);
      setSaveError(null);
      const response = await api.PATCH("/api/users/me", {
        body: { display_name: displayName, bio, is_private: isPrivate },
      });
      setBusy(false);
      if (response.data === undefined) {
        const detail = (response.error as { detail?: string } | undefined)
          ?.detail;
        setSaveError(detail ?? "Your changes could not be saved. Try again.");
        return;
      }
      setMe(response.data);
      setSaved(true);
    },
    [displayName, bio, isPrivate],
  );

  const setAvatar = useCallback(async (mediaId: string): Promise<boolean> => {
    const response = await api.PATCH("/api/users/me", {
      body: { avatar_media_id: mediaId },
    });
    if (response.data === undefined) {
      const detail = (response.error as { detail?: string } | undefined)
        ?.detail;
      setAvatarError(detail ?? "That photograph could not be saved.");
      return false;
    }
    setMe(response.data);
    setAvatarError(null);
    return true;
  }, []);

  const clearAvatar = useCallback(async () => {
    setAvatarBusy(true);
    await setAvatar("");
    setAvatarBusy(false);
  }, [setAvatar]);

  const pickAvatar = useCallback(
    async (file: File) => {
      setAvatarBusy(true);
      setAvatarError(null);
      const media = await uploadMedia(file);
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
    [setAvatar, uploadMedia],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    setSessionError(null);
    const response = await api.DELETE("/api/users/session");
    if (!response.response.ok) {
      setBusy(false);
      setSessionError("Sign out could not complete. Try again.");
      return;
    }
    router.push("/login");
  }, [router]);

  const deleteAccount = useCallback(async () => {
    setBusy(true);
    setDeleteError(null);
    const response = await api.DELETE("/api/users/me");
    if (!response.response.ok) {
      setBusy(false);
      setDeleteError("The account was not deleted. Nothing has changed.");
      return;
    }
    router.push("/login");
  }, [router]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <InstrumentPanel tone="raised">
          <SurfaceState
            variant="error"
            title="Settings could not load"
            description="Your account is unchanged. Check the connection and try again."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setLoadError(false);
                  setLoadAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            }
          />
        </InstrumentPanel>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <InstrumentPanel tone="raised">
          <SurfaceState
            variant="loading"
            title="Loading settings"
            description="Reading your profile and account controls."
          />
        </InstrumentPanel>
      </div>
    );
  }

  return (
    <div data-wide className="mx-auto w-full max-w-5xl py-4 sm:py-8">
      <InstrumentPanel tone="raised" className="overflow-hidden">
        <header className="border-b border-seam px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="font-display text-display-l text-ink">Settings</h1>
            <p className="text-sm text-ink-faint">Signed in as {me.username}</p>
          </div>
        </header>

        <TabBar
          tabs={TABS}
          active={tab}
          onSelect={setTab}
          className="px-3 sm:px-5"
        />

        {tab === "profile" ? (
          <div id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">
            <Section
              icon={Camera}
              title="Avatar"
              note="A square photograph identifies you across Aperture."
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <UserAvatar user={me} className="size-20 shrink-0" />
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={avatarBusy}
                      onClick={() => avatarInput.current?.click()}
                    >
                      {avatarBusy ? "Processing..." : "Choose photograph"}
                    </Button>
                    {me.avatar_url !== null ? (
                      <Button
                        variant="ghost"
                        disabled={avatarBusy}
                        onClick={() => void clearAvatar()}
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
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void pickAvatar(file);
                  }}
                />
              </div>
            </Section>

            <Section
              icon={UserRound}
              title="Public profile"
              note="This information appears beside your published work."
            >
              <form
                onSubmit={(event) => void save(event)}
                aria-busy={busy}
                className="flex flex-col gap-5"
              >
                <label className="flex flex-col gap-2" htmlFor="display-name">
                  <span className="text-label text-ink">Display name</span>
                  <Input
                    id="display-name"
                    value={displayName}
                    maxLength={60}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      markChanged();
                    }}
                  />
                </label>
                <label className="flex flex-col gap-2" htmlFor="profile-bio">
                  <span className="flex items-center justify-between text-label text-ink">
                    <span>Bio</span>
                    <span className="font-mono text-[10px] text-ink-faint">
                      {bio.length}/300
                    </span>
                  </span>
                  <textarea
                    id="profile-bio"
                    value={bio}
                    maxLength={300}
                    rows={4}
                    onChange={(event) => {
                      setBio(event.target.value);
                      markChanged();
                    }}
                    className="w-full resize-y rounded-control border border-seam bg-panel px-3 py-2 text-body text-ink shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)] placeholder:text-ink-faint focus:border-focus"
                  />
                </label>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-[16px] border border-seam bg-panel p-4 text-ink">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(event) => {
                      setIsPrivate(event.target.checked);
                      markChanged();
                    }}
                    className="mt-1 size-5 accent-accent"
                  />
                  <span>
                    <span className="block text-label text-ink">
                      Private account
                    </span>
                    <span className="block text-body text-ink-dim">
                      New followers must be approved before they see
                      follower-only work.
                    </span>
                  </span>
                </label>
                {saveError !== null ? (
                  <p className="text-body text-danger" role="alert">
                    {saveError}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? "Saving..." : "Save profile"}
                  </Button>
                  <span
                    role="status"
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-success"
                  >
                    {saved ? "Changes saved" : ""}
                  </span>
                </div>
              </form>
            </Section>
          </div>
        ) : null}

        {tab === "account" ? (
          <div id="panel-account" role="tabpanel" aria-labelledby="tab-account">
            <Section
              icon={Shield}
              title="Session"
              note="End the active session on this browser only."
            >
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" aria-hidden="true" />
                {busy ? "Signing out..." : "Sign out"}
              </Button>
              {sessionError !== null ? (
                <p className="mt-3 text-body text-danger" role="alert">
                  {sessionError}
                </p>
              ) : null}
            </Section>
            <Section
              icon={LockKeyhole}
              title="Privacy"
              note="Account privacy is controlled with your profile settings."
            >
              <Button variant="secondary" onClick={() => setTab("profile")}>
                Review privacy setting
              </Button>
            </Section>
            <Section
              icon={Trash2}
              title="Delete account"
              note="Posts disappear immediately; stored rows are erased after the grace period."
            >
              {confirmingDelete ? (
                <div className="rounded-[10px] border border-danger/40 bg-danger/10 p-4">
                  <p className="text-body text-ink">
                    Delete your account and hide everything you have posted?
                  </p>
                  <p className="mt-2 text-label text-ink-dim">
                    After the grace period, this cannot be undone.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void deleteAccount()}
                    >
                      {busy ? "Deleting..." : "Delete account"}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep account
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete my account
                </Button>
              )}
              {deleteError !== null ? (
                <p className="mt-3 text-body text-danger" role="alert">
                  {deleteError}
                </p>
              ) : null}
            </Section>
          </div>
        ) : null}
      </InstrumentPanel>
    </div>
  );
}
