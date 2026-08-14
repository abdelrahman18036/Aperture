import { describe, expect, it } from "vitest";

import { classifyMediaFile } from "./file-policy";

describe("classifyMediaFile", () => {
  it("rejects Sun audio before creating an upload intent", () => {
    expect(
      classifyMediaFile({ name: "recording.snd", type: "audio/x-sndr" }),
    ).toEqual({
      accepted: false,
      message:
        "Audio files are not supported. Choose a photo, or an MP4, MOV, or WebM file with a video track.",
    });
  });

  it("accepts supported video MIME types", () => {
    expect(classifyMediaFile({ name: "clip.mp4", type: "video/mp4" })).toEqual({
      accepted: true,
      kind: "video",
    });
  });

  it("uses the extension only when a picker omits the MIME type", () => {
    expect(classifyMediaFile({ name: "frame.avif", type: "" })).toEqual({
      accepted: true,
      kind: "image",
    });
    expect(
      classifyMediaFile({ name: "audio.mp4", type: "audio/x-sndr" }),
    ).toMatchObject({ accepted: false });
  });
});
