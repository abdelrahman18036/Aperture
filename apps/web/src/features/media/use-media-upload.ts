"use client";

import { useCallback } from "react";

import type { Schemas } from "@repo/api-client";

import { api } from "@/lib/api";

/**
 * Upload one file and wait for the worker to finish with it.
 *
 * The composer's `useUpload` does the same three steps and cannot be reused:
 * it owns a phase machine with a crop stage, a progress bar and a cancel
 * button, none of which an avatar or a message attachment wants. What is
 * shared is the *contract* — intent, PUT straight to storage, poll until
 * `ready` — and that is `01-ARCHITECTURE.md` §6 rather than any one
 * component's idea.
 *
 * Bytes go to object storage directly here too. An avatar is small, but a
 * route that proxies uploads through Django is a route somebody later sends a
 * 60MB video to.
 */

type Media = Schemas["Media"];

/** The ceiling, not the wait. A short clip transcodes in a few seconds. */
const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 120_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useMediaUpload(): {
  /** Resolves to the processed media, or null if anything went wrong. */
  uploadMedia: (file: File) => Promise<Media | null>;
} {
  const uploadMedia = useCallback(async (file: File): Promise<Media | null> => {
    // The kind is the file's, not the caller's. A caller that has to declare
    // it is a caller that can declare it wrong, and the server would then
    // reject an upload that is perfectly fine.
    const kind = file.type.startsWith("video/") ? "video" : "image";

    const intent = await api.POST("/api/media/intent", {
      body: { kind, mime: file.type, size_bytes: file.size },
    });
    if (intent.data === undefined) return null;

    const put = await fetch(intent.data.upload_url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    });
    if (!put.ok) return null;

    const completed = await api.POST("/api/media/{media_id}/complete", {
      params: { path: { media_id: intent.data.media.id } },
    });
    if (completed.data === undefined) return null;

    // Poll rather than subscribe. Processing is well under a second for an
    // image and a few seconds for a short clip, and a socket subscription
    // for one file would be more moving parts than the thing it replaces.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await api.GET("/api/media/{media_id}", {
        params: { path: { media_id: intent.data.media.id } },
      });
      if (current.data === undefined) return null;
      if (current.data.state === "ready") return current.data;
      if (current.data.state === "failed") return null;
      await wait(POLL_INTERVAL_MS);
    }
    // Timed out. The media may still become ready — the caller says the
    // upload did not work rather than claiming it did.
    return null;
  }, []);

  return { uploadMedia };
}
