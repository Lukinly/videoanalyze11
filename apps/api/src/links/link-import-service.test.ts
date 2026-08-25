import { describe, expect, it } from "vitest";
import { createLinkImportService } from "./link-import-service.js";

describe("link import service", () => {
  it("returns a read-only YouTube preview with a duration-based quote", async () => {
    let creates = 0;
    const service = createLinkImportService({
      inspector: { inspect: async () => ({ platform: "youtube", externalId: "dQw4w9WgXcQ", part: null, canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Demo", author: "Teacher", duration: 5_401, thumbnailUrl: "https://i.ytimg.com/demo.jpg", isLive: false, subtitleLanguage: "en" }) },
      repository: { findOwnedBySource: async () => null, createLinkVideo: async (input) => { creates += 1; return { id: "video-1", ...input }; } }
    });

    const result = await service.preview({ userId: "user-1", url: "https://youtu.be/dQw4w9WgXcQ" });

    expect(result).toMatchObject({ videoId: null, platform: "youtube", title: "Demo", duration: 5_401, estimatedCost: 97, duplicateStatus: null });
    expect(creates).toBe(0);
  });

  it("rejects live and over-four-hour sources before creating a task", async () => {
    const base = { platform: "youtube" as const, externalId: "dQw4w9WgXcQ", part: null, canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Demo", author: "", thumbnailUrl: "", subtitleLanguage: null };
    const repository = { findOwnedBySource: async () => null, createLinkVideo: async () => { throw new Error("must not persist"); } };
    await expect(createLinkImportService({ inspector: { inspect: async () => ({ ...base, duration: 60, isLive: true }) }, repository }).preview({ userId: "u", url: base.canonicalUrl })).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    await expect(createLinkImportService({ inspector: { inspect: async () => ({ ...base, duration: 14_401, isLive: false }) }, repository }).preview({ userId: "u", url: base.canonicalUrl })).rejects.toMatchObject({ code: "VIDEO_TOO_LONG" });
  });

  it("returns an existing activity instead of duplicating the same source", async () => {
    const service = createLinkImportService({
      inspector: { inspect: async () => ({ platform: "bilibili", externalId: "BV1AB411c7mD", part: 3, canonicalUrl: "https://www.bilibili.com/video/BV1AB411c7mD?p=3", title: "课程 P3", author: "UP", duration: 600, thumbnailUrl: "", isLive: false, subtitleLanguage: "zh-CN" }) },
      repository: { findOwnedBySource: async () => ({ videoId: "old-video", runId: "old-run", runStatus: "running" }), createLinkVideo: async () => { throw new Error("duplicate must not be created"); } }
    });
    await expect(service.preview({ userId: "u", url: "https://www.bilibili.com/video/BV1AB411c7mD?p=3" })).resolves.toMatchObject({ videoId: "old-video", existingRunId: "old-run", duplicateStatus: "running" });
  });

  it("revalidates and persists only when the user confirms", async () => {
    let inspections = 0;
    const service = createLinkImportService({
      inspector: { inspect: async () => { inspections += 1; return { platform: "youtube", externalId: "dQw4w9WgXcQ", part: null, canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Demo", author: "Teacher", duration: 600, thumbnailUrl: "", isLive: false, subtitleLanguage: "en" }; } },
      repository: { findOwnedBySource: async () => null, createLinkVideo: async () => ({ id: "video-1" }) }
    });
    await service.preview({ userId: "u", url: "https://youtu.be/dQw4w9WgXcQ" });
    await expect(service.confirm({ userId: "u", url: "https://youtu.be/dQw4w9WgXcQ" })).resolves.toMatchObject({ videoId: "video-1" });
    expect(inspections).toBe(2);
  });
});
