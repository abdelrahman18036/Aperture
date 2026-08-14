"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import {
  Button,
  DevelopImage,
  Input,
  InstrumentPanel,
  SurfaceState,
  TabBar,
  cn,
} from "@repo/ui";
import type { TabDefinition } from "@repo/ui";

import { api } from "@/lib/api";

import {
  ASPECTS,
  CropStage,
  type AspectName,
  type CropRect,
  cropToBlob,
} from "./crop-stage";
import { MEDIA_ACCEPT, classifyMediaFile } from "./file-policy";
import { TextStory } from "./text-story";
import { useUpload } from "./use-upload";

/**
 * The composer.
 *
 * Pick a file, crop it, describe it, upload it. The upload goes straight to
 * object storage; this component never sends bytes to our own server.
 *
 * Alt text is present for every image and required for none — the design
 * system's quality floor asks for exactly that, and an empty alt is a
 * legitimate answer for a photograph that carries no information a caption
 * does not already give.
 */

type Visibility = "public" | "followers" | "private";

type StoryMode = "photo" | "text";

/** Only ever shown in story mode; a post is a photograph by definition. */
const STORY_MODES: readonly TabDefinition<StoryMode>[] = [
  { id: "photo", label: "Photo or clip" },
  { id: "text", label: "Just words" },
];

/** Mirrors `Post.Visibility`, worded for a person rather than a database. */
const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: "public", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "private", label: "Only me" },
];

interface Picked {
  file: File;
  objectUrl: string;
  kind: "image" | "video";
}

export function Composer({
  toStory: toStoryProp,
  onDone,
}: {
  /** Omitted on the standalone route, where the query string decides. */
  toStory?: boolean;
  /** Called instead of navigating, so a dialog can close itself. */
  onDone?: () => void;
} = {}) {
  // `?to=story` — the tray's plus button is the only way in, and a mode is
  // not a route: the pick-crop-upload flow is identical and only the last
  // step differs.
  // The prop wins; the query is the fallback for a direct visit to
  // `/compose?to=story`, which stays a real route.
  const fromQuery = useSearchParams().get("to") === "story";
  const toStory = toStoryProp ?? fromQuery;
  const [storyMode, setStoryMode] = useState<StoryMode>("photo");
  const router = useRouter();

  /** Where to go when something is published, unless the caller says else. */
  const finish = useCallback(
    (href: string) => {
      if (onDone) onDone();
      else router.push(href);
    },
    [onDone, router],
  );
  const [picked, setPicked] = useState<Picked | null>(null);
  const [aspect, setAspect] = useState<AspectName>("4:5");
  const [altText, setAltText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const cropRef = useRef<{ rect: CropRect; image: HTMLImageElement } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { status, upload, reset, cancel } = useUpload();

  const ratio = ASPECTS.find((a) => a.name === aspect)?.ratio ?? 1;

  const choose = useCallback((file: File) => {
    const decision = classifyMediaFile(file);
    if (!decision.accepted) {
      setSelectionError(decision.message);
      return;
    }

    setSelectionError(null);
    setPicked((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return {
        file,
        objectUrl: URL.createObjectURL(file),
        kind: decision.kind,
      };
    });
  }, []);

  const onCropChange = useCallback(
    (rect: CropRect, image: HTMLImageElement) => {
      cropRef.current = { rect, image };
    },
    [],
  );

  const start = useCallback(async () => {
    if (!picked) return;

    if (picked.kind === "video") {
      // Video is uploaded whole. Trimming and cropping video in the browser
      // is a different project; the worker takes it to 720p.
      await upload(picked.file, "video", picked.file.type);
    } else {
      const crop = cropRef.current;
      if (!crop) return;
      const blob = await cropToBlob(crop.image, crop.rect);
      await upload(blob, "image", "image/jpeg");
    }
  }, [picked, upload]);

  const clear = useCallback(() => {
    setPicked((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
    setAltText("");
    setSelectionError(null);
    reset();
  }, [reset]);

  // Alt text is stored against the media row once it exists.
  const saveAltText = useCallback(
    async (mediaId: string) => {
      await api.PATCH("/api/media/{media_id}", {
        params: { path: { media_id: mediaId } },
        body: { alt_text: altText },
      });
    },
    [altText],
  );

  const busy =
    status.phase === "requesting" ||
    status.phase === "uploading" ||
    status.phase === "processing";

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 sm:gap-6">
      <ol className="grid grid-cols-3 gap-2" aria-label="Publishing progress">
        {["Select", "Prepare", "Publish"].map((label, index) => {
          const active =
            picked === null
              ? index === 0
              : status.phase === "ready"
                ? index === 2
                : index === 1;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "rounded-full border border-seam px-3 py-2 text-center text-sm",
                active
                  ? "border-accent bg-accent text-white"
                  : "bg-panel text-ink-dim",
              )}
            >
              {label}
            </li>
          );
        })}
      </ol>
      {/* Words or a picture. Only for a story: a post is a photograph by
          definition — this is a photo platform — while a story is a day, and
          a day is often just a sentence. */}
      {toStory && picked === null && status.phase === "idle" ? (
        <TabBar tabs={STORY_MODES} active={storyMode} onSelect={setStoryMode} />
      ) : null}

      {toStory && storyMode === "text" && picked === null ? (
        <TextStory
          onPosted={() => {
            finish("/");
          }}
        />
      ) : picked === null ? (
        <InstrumentPanel
          tone="raised"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) choose(file);
          }}
          className={cn(
            "flex min-h-72 flex-col items-center justify-center gap-4 border-dashed px-6 py-12 text-center sm:min-h-96",
            "transition-colors duration-[var(--duration-hover)]",
            dragging && "border-accent bg-accent-soft",
          )}
        >
          <p className="font-display text-display-l text-ink">
            Add photos or video
          </p>
          <p className="max-w-md text-body text-ink-dim">
            Drop a photograph or clip here, or choose one from this device.
          </p>
          <p className="text-sm text-ink-faint">
            JPEG, PNG, WEBP, AVIF, MP4, MOV, or WEBM
          </p>
          {selectionError ? (
            <p className="max-w-md text-sm leading-6 text-danger" role="alert">
              {selectionError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) choose(file);
              event.currentTarget.value = "";
            }}
          />
        </InstrumentPanel>
      ) : null}

      {picked !== null &&
      status.phase !== "ready" &&
      status.phase !== "failed" ? (
        <InstrumentPanel className="grid gap-5 p-3 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
          {picked.kind === "image" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                <span className="meta mr-1">crop</span>
                {ASPECTS.map((option) => (
                  <Button
                    key={option.name}
                    size="sm"
                    variant={option.name === aspect ? "primary" : "ghost"}
                    onClick={() => {
                      setAspect(option.name);
                    }}
                  >
                    {option.name}
                  </Button>
                ))}
              </div>
              <CropStage
                src={picked.objectUrl}
                ratio={ratio}
                onChange={onCropChange}
                className="min-w-0"
              />
            </>
          ) : (
            <video
              src={picked.objectUrl}
              controls
              className="min-h-64 w-full rounded-image bg-black object-contain lg:min-h-96"
            />
          )}

          <label className="flex flex-col gap-2 rounded-[18px] border border-seam bg-panel-raised p-4">
            <span className="meta">
              alt text — describe it for someone who cannot see it
            </span>
            <Input
              value={altText}
              onChange={(event) => {
                setAltText(event.target.value);
              }}
              placeholder="A wet street at night, one streetlight"
              maxLength={1000}
            />
            <span className="meta">optional, but the field is always here</span>
          </label>

          <div className="flex flex-wrap items-center gap-3 lg:col-start-2">
            <Button
              variant="primary"
              onClick={() => {
                void start();
              }}
              disabled={busy}
            >
              {busy ? "Working…" : "Upload"}
            </Button>
            <Button variant="ghost" onClick={busy ? cancel : clear}>
              {busy ? "Cancel" : "Choose another"}
            </Button>
          </div>
        </InstrumentPanel>
      ) : null}

      {status.phase === "requesting" ? (
        <SurfaceState
          variant="loading"
          title="Preparing upload"
          description="Preparing a secure upload for this file."
          compact
        />
      ) : null}

      {status.phase === "uploading" ? (
        <InstrumentPanel
          className="flex flex-col gap-3 p-4"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-seam"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(status.progress * 100)}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[var(--duration-hover)] motion-reduce:transition-none"
              style={{ width: `${String(Math.round(status.progress * 100))}%` }}
            />
          </div>
          <span className="meta">
            Uploading · {Math.round(status.progress * 100)}%
          </span>
        </InstrumentPanel>
      ) : null}

      {status.phase === "processing" ? (
        <SurfaceState
          variant="loading"
          title="Developing media"
          description="Validating the file and preparing display sizes. This may take a moment."
        />
      ) : null}

      {status.phase === "failed" ? (
        <SurfaceState
          variant="error"
          title="Media could not be prepared"
          description={status.message}
          action={
            <Button variant="secondary" onClick={clear}>
              Choose another file
            </Button>
          }
        />
      ) : null}

      {status.phase === "ready" ? (
        <PublishForm
          media={status.media}
          altText={altText}
          onSaveAltText={saveAltText}
          onDiscard={clear}
          toStory={toStory}
          onFinish={finish}
        />
      ) : null}
    </div>
  );
}

/**
 * The last step, and until now the missing one.
 *
 * The composer uploaded media and then offered to upload more — it never
 * called `POST /api/posts/`, so **nothing could be published from the UI at
 * all**. Every post in the database arrived from `seed_demo`. The media
 * pipeline was complete and the thing it exists for was not connected to it.
 *
 * Caption, location and visibility live here rather than beside the file
 * picker because they describe the post, and the post does not exist until
 * the media is processed. Alt text is the exception: it belongs to the media
 * row, and is saved against it.
 */
function PublishForm({
  media,
  altText,
  onSaveAltText,
  onDiscard,
  toStory,
  onFinish,
}: {
  toStory: boolean;
  /** Navigate, or close a dialog — the caller decides which. */
  onFinish: (href: string) => void;
  media: {
    id: string;
    blurhash: string;
    dominant_color: string;
    width: number | null;
    height: number | null;
    sources: { width: number; url: string }[];
    original_url: string | null;
    poster_url: string | null;
    kind: string;
  };
  altText: string;
  onSaveAltText: (mediaId: string) => Promise<void>;
  onDiscard: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview =
    media.sources.at(-1)?.url ?? media.poster_url ?? media.original_url;

  const publish = useCallback(async () => {
    setBusy(true);
    setError(null);

    // Alt text first. A post that exists with an unsaved description is
    // worse than a moment more waiting, and this is the only chance the
    // person has to write it.
    try {
      await onSaveAltText(media.id);
    } catch {
      setBusy(false);
      setError(
        "The media description could not be saved. Check your connection and try again.",
      );
      return;
    }

    if (toStory) {
      const story = await api.POST("/api/stories/create", {
        body: { media_id: media.id, caption, text: "", background: "slate" },
      });
      setBusy(false);
      if (story.data === undefined) {
        const detail = (story.error as { detail?: string } | undefined)?.detail;
        setError(detail ?? "That did not post. Try again.");
        return;
      }
      // Back to the feed, where the tray is — a story has no page of its
      // own to land on, and the ring going warm is the confirmation.
      onFinish("/");
      return;
    }

    const response = await api.POST("/api/posts/create", {
      body: {
        media_ids: [media.id],
        caption,
        location,
        visibility,
      },
    });

    setBusy(false);
    if (response.data === undefined) {
      const detail = (response.error as { detail?: string } | undefined)
        ?.detail;
      setError(detail ?? "That did not publish. Try again.");
      return;
    }
    // Straight to the post. Landing back on an empty composer gives no
    // evidence that anything happened.
    onFinish(`/p/${response.data.id}`);
  }, [
    caption,
    location,
    visibility,
    media.id,
    onSaveAltText,
    onFinish,
    toStory,
  ]);

  return (
    <InstrumentPanel className="grid gap-5 p-3 sm:p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="text-sm font-medium text-accent">
          Ready · {media.width}×{media.height}
        </span>

        {preview && media.width && media.height ? (
          <DevelopImage
            src={preview}
            sources={media.sources}
            alt={altText}
            width={media.width}
            height={media.height}
            blurhash={media.blurhash}
            dominantColor={media.dominant_color}
            priority
            fit="contain"
            className="max-h-[62dvh] w-full rounded-image bg-black"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-5 rounded-instrument border border-seam bg-panel-raised p-4">
        <label className="flex flex-col gap-2">
          <span className="meta">caption</span>
          <textarea
            value={caption}
            maxLength={2200}
            rows={3}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
            placeholder="Add the story behind this work"
            className="min-h-24 w-full resize-y rounded-[14px] border border-seam bg-panel p-3 text-body text-ink placeholder:text-ink-faint focus-visible:border-accent"
          />
        </label>

        {/* Neither belongs to a story. A story is one frame for one day —
          it has no location line and no audience of its own, because who
          sees it is already decided by who follows you. */}
        {!toStory ? (
          <label className="flex flex-col gap-2">
            <span className="meta">location</span>
            <Input
              value={location}
              maxLength={120}
              onChange={(event) => {
                setLocation(event.target.value);
              }}
            />
          </label>
        ) : null}

        <fieldset className={cn("flex flex-col gap-2", toStory && "hidden")}>
          <legend className="meta">who can see it</legend>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {VISIBILITIES.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 items-center gap-2 rounded-[14px] border border-seam bg-panel px-3"
              >
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === option.value}
                  onChange={() => {
                    setVisibility(option.value);
                  }}
                  className="accent-accent"
                />
                <span className="text-body text-ink">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error !== null ? (
          <p className="text-body text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-seam pt-4">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void publish();
            }}
          >
            {busy
              ? toStory
                ? "Posting…"
                : "Publishing…"
              : toStory
                ? "Add to story"
                : "Publish"}
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </InstrumentPanel>
  );
}
