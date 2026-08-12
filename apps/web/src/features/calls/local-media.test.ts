import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaUnavailableError, openLocalMedia } from "./local-media";

/**
 * The degradation rules, which are the whole reason this module exists.
 *
 * It replaced a single `getUserMedia({ audio: true, video: true })`, and that
 * line's failure mode is the thing being pinned here: it fails as a unit, so
 * a desktop with no webcam got no call at all — not even audio — and was told
 * "microphone and camera access is required", which pointed at the wrong
 * thing and suggested a fix that could not work.
 *
 * There is no browser in this suite and none is needed. `navigator` is the
 * only dependency, and stubbing it keeps these tests about the branching
 * rather than about whether Chrome can open a camera.
 */

interface Attempt {
  audio?: boolean;
  video?: boolean;
}

/** A `mediaDevices` that fails in whichever way a test asks for. */
function stubDevices(
  behaviour: (constraints: Attempt) => Promise<MediaStream>,
): Attempt[] {
  const attempts: Attempt[] = [];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: (constraints: Attempt) => {
        attempts.push(constraints);
        return behaviour(constraints);
      },
    },
  });
  return attempts;
}

function fakeStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function domError(name: string): DOMException {
  return new DOMException("stubbed", name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when everything works", () => {
  it("asks for audio and video together and reports full media", async () => {
    const attempts = stubDevices(() => Promise.resolve(fakeStream()));

    const media = await openLocalMedia();

    expect(media.audioOnly).toBe(false);
    // One call, not two. Asking separately when both are available would
    // cost a second permission prompt on some browsers.
    expect(attempts).toEqual([{ audio: true, video: true }]);
  });
});

describe("when there is no camera", () => {
  it.each(["NotFoundError", "NotReadableError", "OverconstrainedError"])(
    "falls back to audio on %s",
    async (name) => {
      const attempts = stubDevices((constraints) =>
        constraints.video === true
          ? Promise.reject(domError(name))
          : Promise.resolve(fakeStream()),
      );

      const media = await openLocalMedia();

      expect(media.audioOnly).toBe(true);
      expect(attempts).toEqual([
        { audio: true, video: true },
        { audio: true },
      ]);
    },
  );

  it("still fails when the microphone is missing too", async () => {
    stubDevices(() => Promise.reject(domError("NotFoundError")));

    await expect(openLocalMedia()).rejects.toBeInstanceOf(
      MediaUnavailableError,
    );
    await expect(openLocalMedia()).rejects.toThrow(/no microphone/i);
  });
});

describe("when permission is refused", () => {
  it("does not retry, because a second prompt will not help", async () => {
    // Denied is not absent. Retrying audio-only after a refusal asks the same
    // question again and gets the same answer, having wasted a round trip.
    const attempts = stubDevices(() =>
      Promise.reject(domError("NotAllowedError")),
    );

    await expect(openLocalMedia()).rejects.toBeInstanceOf(
      MediaUnavailableError,
    );
    expect(attempts).toHaveLength(1);
  });

  it("names the permission rather than the hardware", async () => {
    stubDevices(() => Promise.reject(domError("NotAllowedError")));

    // The distinction decides what the person can do about it: a permission
    // is actionable, absent hardware is not.
    await expect(openLocalMedia()).rejects.toThrow(/permission/i);
  });

  it("also names it when only the microphone is refused", async () => {
    stubDevices((constraints) =>
      constraints.video === true
        ? Promise.reject(domError("NotFoundError"))
        : Promise.reject(domError("NotAllowedError")),
    );

    await expect(openLocalMedia()).rejects.toThrow(/permission/i);
  });
});

describe("when the browser will not offer devices at all", () => {
  it("says so, because the fix is the URL and not a click", async () => {
    vi.stubGlobal("navigator", {});

    await expect(openLocalMedia()).rejects.toThrow(/insecure/i);
  });
});

describe("unexpected failures", () => {
  it("are not swallowed as a missing camera", async () => {
    // A bug in our own code must not be reported to the user as "no webcam".
    const boom = new TypeError("something else went wrong");
    stubDevices(() => Promise.reject(boom));

    await expect(openLocalMedia()).rejects.toBe(boom);
  });
});
