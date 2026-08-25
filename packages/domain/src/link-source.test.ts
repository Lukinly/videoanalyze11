import { describe, expect, it } from "vitest";
import { parseVideoLink, timestampedVideoUrl } from "./link-source.js";

describe("video link sources", () => {
  it("normalizes one YouTube video and discards playlist tracking", () => {
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=12")).toEqual({
      platform: "youtube",
      externalId: "dQw4w9WgXcQ",
      part: null,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
  });

  it("normalizes YouTube shorts and Bilibili video parts", () => {
    expect(parseVideoLink("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share")?.canonicalUrl)
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parseVideoLink("https://www.bilibili.com/video/BV1AB411c7mD/?p=3&spm_id_from=333"))
      .toEqual({ platform: "bilibili", externalId: "BV1AB411c7mD", part: 3, canonicalUrl: "https://www.bilibili.com/video/BV1AB411c7mD?p=3" });
  });

  it("rejects unsupported hosts and non-http URLs", () => {
    expect(parseVideoLink("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoLink("file:///etc/passwd")).toBeNull();
    expect(parseVideoLink("https://www.bilibili.com/video/bv1ab411c7md")).toBeNull();
  });

  it("creates platform timestamp links without preserving untrusted query parameters", () => {
    expect(timestampedVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 1004)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1004s");
    expect(timestampedVideoUrl("https://www.bilibili.com/video/BV1AB411c7mD?p=3", 1004)).toBe("https://www.bilibili.com/video/BV1AB411c7mD?p=3&t=1004");
  });
});
