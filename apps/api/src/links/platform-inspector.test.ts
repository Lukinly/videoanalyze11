import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createPlatformInspector, resolveBilibiliShortUrl } from "./platform-inspector.js";

describe("platform metadata inspector", () => {
  const publicView = (overrides: Record<string, unknown> = {}) => ({
    bvid: "BV1AB411c7mD", title: "课程", owner: { name: "UP" },
    pic: "https://img.example/b.jpg", rights: { pay: 0, ugc_pay: 0, arc_pay: 0 },
    pages: [{ page: 1, part: "一", duration: 400 }, { page: 3, part: "三", duration: 200 }],
    ...overrides
  });
  it("maps yt-dlp metadata and prefers an original manual subtitle", async () => {
    const inspector = createPlatformInspector({ run: async () => JSON.stringify({
      id: "dQw4w9WgXcQ", title: "Lesson", uploader: "Teacher", duration: 321, thumbnail: "https://img.example/1.jpg",
      live_status: "not_live", language: "en", subtitles: { en: [{ ext: "vtt", url: "https://sub.example/en.vtt" }] }, automatic_captions: { "zh-Hans": [{ ext: "vtt", url: "https://sub.example/zh.vtt" }] }
    }) });
    await expect(inspector.inspect("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({ platform: "youtube", externalId: "dQw4w9WgXcQ", title: "Lesson", subtitleLanguage: "en", subtitleKind: "manual" });
  });

  it("normalizes YouTube original-language tags before deterministic fallback", async () => {
    const inspector = createPlatformInspector({ run: async () => JSON.stringify({
      title: "Lesson", duration: 60, live_status: "not_live", original_language: "en-US",
      subtitles: { fr: [{}], en: [{}] }, automatic_captions: {}
    }) });
    await expect(inspector.inspect("https://youtu.be/dQw4w9WgXcQ")).resolves.toMatchObject({ subtitleLanguage: "en", subtitleKind: "manual" });
  });

  it("reads all metadata for a selected part in one library command without a second view request", async () => {
    const run = vi.fn(async () => JSON.stringify(publicView()));
    const inspector = createPlatformInspector({
      run, allowBrowserFallback: false
    });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD?p=3")).resolves.toMatchObject({ platform: "bilibili", part: 3, title: "课程 · 三", duration: 200, thumbnailUrl: "https://img.example/b.jpg", subtitleLanguage: "zh-CN" });
    expect(run).toHaveBeenCalledExactlyOnceWith("python3", [fileURLToPath(new URL("../../scripts/bilibili-metadata.py", import.meta.url)), "BV1AB411c7mD"]);
  });

  it("keeps subtitle probing enabled and bills the first part instead of the combined duration", async () => {
    const inspector = createPlatformInspector({
      fetchBilibiliView: async () => publicView({ duration: 600, pic: "http://img.example/b.jpg" })
    });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).resolves.toMatchObject({ duration: 400, subtitleLanguage: "zh-CN", thumbnailUrl: "https://img.example/b.jpg" });
  });

  it("rejects a Bilibili part number that the public video does not contain", async () => {
    const inspector = createPlatformInspector({
      fetchBilibiliView: async () => publicView({ pages: [{ page: 1, part: "一", duration: 600 }] })
    });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD?p=3")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });

  it("does not guess the duration from incomplete or mismatched metadata", async () => {
    for (const overrides of [{ bvid: "BV1BFnh6KEuW" }, { pages: [] }, { pages: [{ page: 1, duration: 0 }] }]) {
      const inspector = createPlatformInspector({ allowBrowserFallback: false, fetchBilibiliView: async () => publicView(overrides) });
      await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    }
  });

  it("rejects paid and redirected episode metadata before importing", async () => {
    for (const overrides of [{ rights: { pay: 1 } }, { rights: { ugc_pay: 1 } }, { rights: { arc_pay: 1 } }, { redirect_url: "https://www.bilibili.com/bangumi/play/ep123" }]) {
      const inspector = createPlatformInspector({ fetchBilibiliView: async () => publicView(overrides) });
      await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    }
  });

  const browserRows = (overrides: Record<string, unknown> = {}) => JSON.stringify(Object.entries({ bvid: "BV1AB411c7mD", page: "1", title: "第一集", series_title: "公开视频", author: "UP (mid: 123)", duration: "5m49s (349s)", thumbnail: "https://img.example/b.jpg", requires_payment: "false", redirect_url: "", ...overrides }).map(([field, value]) => ({ field, value })));

  it("uses the local browser when the library is blocked, requesting the first part instead of the combined duration", async () => {
    const run = vi.fn(async (command: string) => {
      if (command === "python3") throw new Error("Bilibili HTTP 412");
      return browserRows();
    });
    const inspector = createPlatformInspector({ run, allowBrowserFallback: true });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).resolves.toMatchObject({ title: "公开视频", duration: 349, author: "UP", subtitleLanguage: "zh-CN" });
    expect(run).toHaveBeenLastCalledWith("opencli", ["bilibili", "video", "BV1AB411c7mD", "--page", "1", "-f", "json"]);
  });

  it("preserves the requested part when library access is blocked", async () => {
    const run = vi.fn(async () => browserRows({ page: "3", title: "第三集", duration: "1m0s (60s)" }));
    const inspector = createPlatformInspector({ run, allowBrowserFallback: true, fetchBilibiliView: async () => { throw new Error("HTTP 412"); } });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD?p=3")).resolves.toMatchObject({ title: "公开视频 · 第三集", part: 3, duration: 60 });
    expect(run).toHaveBeenLastCalledWith("opencli", ["bilibili", "video", "BV1AB411c7mD", "--page", "3", "-f", "json"]);
  });

  it("keeps browser access disabled when configured and returns an actionable error without shell details", async () => {
    const run = vi.fn(async () => { throw new Error("Bilibili HTTP 412 <html>security control</html>"); });
    const inspector = createPlatformInspector({ run, allowBrowserFallback: false });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA", status: 422, message: "B站暂时限制了自动读取（HTTP 412）。请稍后重试，或上传本地视频。" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not accept browser metadata for another video or unavailable part", async () => {
    for (const overrides of [{ bvid: "BV1BFnh6KEuW" }, { page: "2" }, { duration: "unknown" }]) {
      const inspector = createPlatformInspector({ allowBrowserFallback: true, run: async (command) => { if (command === "python3") throw new Error("HTTP 412"); return browserRows(overrides); } });
      await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    }
  });

  it("rejects paid content returned by the browser before importing", async () => {
    const inspector = createPlatformInspector({ allowBrowserFallback: true, run: async (command) => { if (command === "python3") throw new Error("HTTP 412"); return browserRows({ requires_payment: "true" }); } });
    await expect(inspector.inspect("https://www.bilibili.com/video/BV1AB411c7mD")).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA", message: expect.stringContaining("付费") });
  });
});

describe("Bilibili short-link resolution", () => {
  it("validates a redirect destination before following it", async () => {
    const fetcher = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
    await expect(resolveBilibiliShortUrl("https://b23.tv/abc", fetcher)).rejects.toThrow("unsafe redirect");
  });

  it("follows only bounded Bilibili redirects", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string | URL) => {
      calls.push(String(url));
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://www.bilibili.com/video/BV1AB411c7mD" } })
        : new Response("ok", { status: 200 });
    };
    await expect(resolveBilibiliShortUrl("https://b23.tv/abc", fetcher)).resolves.toBe("https://www.bilibili.com/video/BV1AB411c7mD");
    expect(calls).toHaveLength(2);
  });
});
