"use client";

import { useCallback, useRef, useState } from "react";

import { Button, DevelopImage, Input, Skeleton, cn } from "@repo/ui";

import { api } from "@/lib/api";

import {
  ASPECTS,
  CropStage,
  type AspectName,
  type CropRect,
  cropToBlob,
} from "./crop-stage";
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

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm";

interface Picked {
  file: File;
  objectUrl: string;
  kind: "image" | "video";
}

export function Composer() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [aspect, setAspect] = useState<AspectName>("4:5");
  const [altText, setAltText] = useState("");
  const [dragging, setDragging] = useState(false);

  const cropRef = useRef<{ rect: CropRect; image: HTMLImageElement } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { status, upload, reset, cancel } = useUpload();

  const ratio = ASPECTS.find((a) => a.name === aspect)?.ratio ?? 1;

  const choose = useCallback((file: File) => {
    const kind = file.type.startsWith("video/") ? "video" : "image";
    setPicked((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return { file, objectUrl: URL.createObjectURL(file), kind };
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
    <div className="flex w-full max-w-feed flex-col gap-8">
      {picked === null ? (
        <div
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
            "flex min-h-64 flex-col items-center justify-center gap-4 rounded-image",
            "border border-dashed border-line px-6 py-16 text-center",
            "transition-colors duration-[var(--duration-hover)]",
            dragging && "border-safelight-dim bg-surface",
          )}
        >
          <p className="font-display text-display-l text-ink">
            Drop a photograph
          </p>
          <p className="meta">jpeg · png · webp · avif · mp4 · mov · webm</p>
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
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) choose(file);
            }}
          />
        </div>
      ) : null}

      {picked !== null && status.phase !== "ready" ? (
        <div className="flex flex-col gap-6">
          {picked.kind === "image" ? (
            <>
              <div className="flex items-center gap-2">
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
              />
            </>
          ) : (
            <video
              src={picked.objectUrl}
              controls
              className="w-full rounded-image bg-surface"
            />
          )}

          <label className="flex flex-col gap-2">
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

          <div className="flex items-center gap-3">
            <Button
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
        </div>
      ) : null}

      {status.phase === "uploading" ? (
        <div className="flex flex-col gap-2">
          <div className="h-px w-full bg-line">
            <div
              className="h-px bg-safelight transition-[width] duration-[var(--duration-hover)]"
              style={{ width: `${String(Math.round(status.progress * 100))}%` }}
            />
          </div>
          <span className="meta">
            uploading {Math.round(status.progress * 100)}%
          </span>
        </div>
      ) : null}

      {status.phase === "processing" ? (
        <div className="flex flex-col gap-3">
          <span className="meta">developing — validating and deriving</span>
          <Skeleton className="aspect-[4/5] w-full" />
        </div>
      ) : null}

      {status.phase === "failed" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-danger">{status.message}</p>
          <div>
            <Button variant="secondary" onClick={clear}>
              Try another file
            </Button>
          </div>
        </div>
      ) : null}

      {status.phase === "ready" ? (
        <ReadyPreview
          media={status.media}
          altText={altText}
          onSaveAltText={saveAltText}
          onDone={clear}
        />
      ) : null}
    </div>
  );
}

function ReadyPreview({
  media,
  altText,
  onSaveAltText,
  onDone,
}: {
  media: { id: string; blurhash: string; dominant_color: string; width: number | null; height: number | null; sources: { width: number; url: string }[]; original_url: string | null; poster_url: string | null; kind: string };
  altText: string;
  onSaveAltText: (mediaId: string) => Promise<void>;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);

  const preview =
    media.sources.at(-1)?.url ?? media.poster_url ?? media.original_url;

  return (
    <div className="flex flex-col gap-5">
      <span className="meta">ready — {media.width}×{media.height}</span>

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
        />
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            void onSaveAltText(media.id).then(() => {
              setSaved(true);
            });
          }}
        >
          {saved ? "Alt text saved" : "Save alt text"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Upload another
        </Button>
      </div>
    </div>
  );
}
