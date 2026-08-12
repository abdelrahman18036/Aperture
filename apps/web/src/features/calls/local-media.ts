"use client";

/**
 * Getting the microphone and camera, and degrading properly when you cannot.
 *
 * This started as one line — `getUserMedia({ audio: true, video: true })` —
 * which fails as a unit. A desktop with no webcam is not an edge case, and on
 * one of those that line means *no calls at all*, not even audio, with the
 * message "microphone and camera access is required" pointing at the wrong
 * thing entirely.
 *
 * So: audio is the call, video is an enhancement. If the camera is missing or
 * busy we take audio and say so. Only a call with no audio is a failed call.
 *
 * **Denied is not the same as absent**, and the distinction decides what the
 * person can do about it. `NotAllowedError` means they said no, or the browser
 * did on their behalf — actionable, and worth naming the permission.
 * `NotFoundError` and `NotReadableError` mean the hardware is not there or is
 * held by something else, which no amount of clicking allow will fix.
 */

export interface LocalMedia {
  stream: MediaStream;
  /** True when the camera could not be opened and only audio was acquired. */
  audioOnly: boolean;
}

export class MediaUnavailableError extends Error {}

/** The errors that mean "this device cannot do that", not "you refused". */
function isMissingDevice(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "NotFoundError" ||
    error.name === "NotReadableError" ||
    error.name === "OverconstrainedError"
  );
}

function isDenied(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

/**
 * Open the best stream this machine can manage.
 *
 * Throws `MediaUnavailableError` with a message worth showing only when there
 * is no usable audio, because that is the only case where there is no call to
 * be had.
 */
export async function openLocalMedia(): Promise<LocalMedia> {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (devices === undefined) {
    // Insecure context, typically. Worth naming, because the fix is the URL
    // rather than anything the person can click.
    throw new MediaUnavailableError(
      "This browser will not share a microphone over an insecure connection.",
    );
  }

  try {
    const stream = await devices.getUserMedia({ audio: true, video: true });
    return { stream, audioOnly: false };
  } catch (error) {
    if (isDenied(error)) {
      throw new MediaUnavailableError(
        "Aperture needs permission to use your microphone to place a call.",
      );
    }
    if (!isMissingDevice(error)) throw error;
  }

  // The camera is absent or busy. Audio alone is still a call.
  try {
    const stream = await devices.getUserMedia({ audio: true });
    return { stream, audioOnly: true };
  } catch (error) {
    if (isDenied(error)) {
      throw new MediaUnavailableError(
        "Aperture needs permission to use your microphone to place a call.",
      );
    }
    throw new MediaUnavailableError(
      "No microphone is available, so there is nothing to call with.",
    );
  }
}
