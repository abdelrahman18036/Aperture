"use client";

import { useCallback, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";

import { api } from "@/lib/api";

/**
 * The upload flow, as one hook.
 *
 *     intent -> presigned PUT -> complete -> poll until state settles
 *
 * The PUT goes straight to object storage and never through Django or
 * Next.js. `01-ARCHITECTURE.md` §6 is emphatic about that at every scale, so
 * developing against the same path is the point.
 *
 * Polling, not sockets: Phase 6 replaces this with a `media.ready` event, and
 * `status` is deliberately shaped the way a socket handler would also produce
 * it so that swap touches one function.
 */

export type Media = Schemas["Media"];

export type UploadStatus =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "uploading"; progress: number }
  | { phase: "processing"; media: Media }
  | { phase: "ready"; media: Media }
  | { phase: "failed"; message: string };

/** How often to ask whether the worker has finished, and for how long. */
const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 180_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PUT with progress.
 *
 * `fetch` still cannot report upload progress, so this is the one place XHR
 * earns its keep. A progress bar on a 12MB upload is not decoration.
 */
function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(
        new Error(`Storage rejected the upload (${String(request.status)}).`),
      );
    });
    request.addEventListener("error", () => {
      reject(new Error("The upload failed. Check your connection."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("Upload cancelled."));
    });

    signal.addEventListener("abort", () => {
      request.abort();
    });
    request.send(blob);
  });
}

export interface UseUpload {
  status: UploadStatus;
  upload: (file: Blob, kind: "image" | "video", mime: string) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useUpload(): UseUpload {
  const [status, setStatus] = useState<UploadStatus>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setStatus({ phase: "idle" });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const upload = useCallback(
    async (file: Blob, kind: "image" | "video", mime: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setStatus({ phase: "requesting" });

        const intent = await api.POST("/api/media/intent", {
          body: { kind, mime, size_bytes: file.size },
        });

        if (intent.data === undefined) {
          // The server's rejections are written for a person — "That image is
          // 62MB. The limit is 25MB." — so show them rather than a generic
          // failure.
          setStatus({
            phase: "failed",
            message: detailOf(intent.error) ?? "That file was not accepted.",
          });
          return;
        }

        setStatus({ phase: "uploading", progress: 0 });
        await putWithProgress(
          intent.data.upload_url,
          file,
          mime,
          (progress) => {
            setStatus({ phase: "uploading", progress });
          },
          controller.signal,
        );

        const mediaId = intent.data.media.id;
        const completed = await api.POST("/api/media/{media_id}/complete", {
          params: { path: { media_id: mediaId } },
        });
        if (completed.data === undefined) {
          setStatus({
            phase: "failed",
            message: "Could not start processing.",
          });
          return;
        }

        setStatus({ phase: "processing", media: completed.data });
        const settled = await pollUntilSettled(mediaId, controller.signal);
        setStatus(
          settled.state === "ready"
            ? { phase: "ready", media: settled }
            : {
                phase: "failed",
                message: settled.failure_reason || "Processing failed.",
              },
        );
      } catch (error) {
        setStatus({
          phase: "failed",
          message:
            error instanceof Error ? error.message : "Something went wrong.",
        });
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  return { status, upload, reset, cancel };
}

async function pollUntilSettled(
  mediaId: string,
  signal: AbortSignal,
): Promise<Media> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Upload cancelled.");
    await sleep(POLL_INTERVAL_MS);

    const current = await api.GET("/api/media/{media_id}", {
      params: { path: { media_id: mediaId } },
    });
    if (current.data === undefined) continue;
    if (current.data.state !== "pending") return current.data;
  }

  throw new Error("Processing is taking longer than expected.");
}

/** DRF puts its user-facing rejections in `detail`. */
function detailOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail: unknown = (error as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return undefined;
}
