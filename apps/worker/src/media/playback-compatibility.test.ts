import { describe, expect, it } from "vitest";
import { assessPlaybackCompatibility } from "./playback-compatibility.js";

describe("playback compatibility", () => {
  it("requires an explicit remux for MKV and non-browser codecs", () => {
    expect(assessPlaybackCompatibility({ container: "matroska", videoCodec: "hevc", audioCodecs: ["opus"] })).toEqual({
      playable: false,
      requiresRemux: true,
      reason: "container_or_codec"
    });
  });

  it("accepts browser baseline H.264/AAC MP4", () => {
    expect(assessPlaybackCompatibility({ container: "mp4", videoCodec: "h264", audioCodecs: ["aac"] })).toEqual({ playable: true, requiresRemux: false });
  });
});
