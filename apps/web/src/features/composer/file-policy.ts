export type MediaFileKind = "image" | "video";

export const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm";

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);

export type MediaFileDecision =
  | { accepted: true; kind: MediaFileKind }
  | { accepted: false; message: string };

/**
 * Browsers normally provide a MIME type, but mobile file pickers sometimes
 * leave it blank. Extension fallback is only a picker convenience; the API
 * still inspects the bytes before any post can be published.
 */
export function classifyMediaFile(file: {
  name: string;
  type: string;
}): MediaFileDecision {
  const mime = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (
    IMAGE_MIMES.has(mime) ||
    (mime === "" && IMAGE_EXTENSIONS.has(extension))
  ) {
    return { accepted: true, kind: "image" };
  }

  if (
    VIDEO_MIMES.has(mime) ||
    (mime === "" && VIDEO_EXTENSIONS.has(extension))
  ) {
    return { accepted: true, kind: "video" };
  }

  if (mime.startsWith("audio/")) {
    return {
      accepted: false,
      message:
        "Audio files are not supported. Choose a photo, or an MP4, MOV, or WebM file with a video track.",
    };
  }

  return {
    accepted: false,
    message:
      "Choose a JPEG, PNG, WebP, or AVIF photo, or an MP4, MOV, or WebM video.",
  };
}
