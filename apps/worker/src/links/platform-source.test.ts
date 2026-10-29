import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPlatformSourceLoader, materializeImportedSegments, parseWebVtt, parseBilibiliTimeline } from "./platform-source.js";

describe("remote platform transcripts", () => {
  it("resolves a part-aware video stream and forwards required playback headers", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ url: "https://cdn.example/video.m4s", http_headers: { Referer: "https://www.bilibili.com/" } }), stderr: "" });
    const loader = createPlatformSourceLoader({ runner: { run } });
    await expect(loader.resolveFrameSource({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1AB411c7mD?p=3", subtitleLanguage: null })).resolves.toEqual({ path: "https://cdn.example/video.m4s", headers: { Referer: "https://www.bilibili.com/" } });
    expect(run).toHaveBeenCalledWith("python3", [fileURLToPath(new URL("../../scripts/bilibili-part.py", import.meta.url)), "frames", "BV1AB411c7mD", "3"], expect.anything());
  });

  it("converts WebVTT cues to monotonic transcript segments and removes tags", () => {
    const result = parseWebVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello <c.color>world</c>\n\n00:00:03.500 --> 00:00:05.000\nSecond line\n`);
    expect(result).toEqual([{ start: 1, end: 3.5, text: "Hello world" }, { start: 3.5, end: 5, text: "Second line" }]);
  });

  it("accepts bili-cli timeline cue shapes", () => {
    expect(parseBilibiliTimeline(JSON.stringify({ subtitles: [{ from: 2.1, to: 4.2, content: "第一句" }, { start: 4.2, end: 6, text: "第二句" }] })))
      .toEqual([{ start: 2.1, end: 4.2, text: "第一句" }, { start: 4.2, end: 6, text: "第二句" }]);
  });

  it("parses browser subtitle timestamps without discarding the seconds suffix or accepting invalid times", () => {
    expect(parseBilibiliTimeline(JSON.stringify([{ from: "0.04s", to: "0.86s", content: "第一句" }, { from: null, to: "1s", content: "无效" }, { from: "1.2s", to: "0.8s", content: "倒序" }])))
      .toEqual([{ start: 0.04, end: 0.86, text: "第一句" }]);
  });

  it.each(["blocked", "empty"])("uses browser subtitles when bili returns %s and preserves the part", async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-bilibili-subtitle-"));
    const run = vi.fn(async (command: string) => {
      if (command !== "opencli") { if (mode === "blocked") throw new Error("HTTP 412"); return { stdout: '{"items":[]}', stderr: "" }; }
      return { stdout: JSON.stringify([{ from: "1.25s", to: "2.5s", content: "第三分P" }]), stderr: "" };
    });
    const loader = createPlatformSourceLoader({ runner: { run }, allowBrowserFallback: true });
    try {
      await expect(loader.tryTranscript({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1AB411c7mD?p=3", subtitleLanguage: "zh-CN" }, directory)).resolves.toEqual([{ start: 1.25, end: 2.5, text: "第三分P" }]);
      expect(run).toHaveBeenLastCalledWith("opencli", ["bilibili", "subtitle", "BV1AB411c7mD", "--page", "3", "-f", "json"], expect.objectContaining({ timeoutMs: 120_000 }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not start a browser command after cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-bilibili-cancel-"));
    const controller = new AbortController();
    const run = vi.fn(async () => { controller.abort(); throw new Error("cancelled"); });
    try {
      const loader = createPlatformSourceLoader({ runner: { run }, allowBrowserFallback: true });
      await expect(loader.tryTranscript({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1AB411c7mD", subtitleLanguage: "zh-CN" }, directory, controller.signal)).rejects.toThrow("cancelled");
      expect(run).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("uses the part-aware Bilibili helper for a selected p", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const loader = createPlatformSourceLoader({ runner: { run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: JSON.stringify({ items: [{ from: 1, to: 2, content: "第三分P" }] }), stderr: "" };
    } } });
    await expect(loader.tryTranscript({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1AB411c7mD?p=3", subtitleLanguage: "zh-CN" }, "/tmp/videoanalyze-test-subtitle"))
      .resolves.toEqual([{ start: 1, end: 2, text: "第三分P" }]);
    expect(calls[0]).toMatchObject({ command: "python3", args: [fileURLToPath(new URL("../../scripts/bilibili-part.py", import.meta.url)), "subtitle", "BV1AB411c7mD", "3"] });
  });

  it("uses the Bilibili helper to download audio from the default part", async () => {
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-bilibili-audio-"));
    const loader = createPlatformSourceLoader({ runner: { run: async (command: string, args: string[]) => {
      expect(command).toBe("python3");
      expect(args).toEqual([fileURLToPath(new URL("../../scripts/bilibili-part.py", import.meta.url)), "audio", "BV1Mo836fErR", "1", directory]);
      await writeFile(join(directory, "source.m4a"), "audio");
      return { stdout: "", stderr: "" };
    } } });

    try {
      await expect(loader.downloadAudio({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1Mo836fErR", subtitleLanguage: "zh-CN" }, directory))
        .resolves.toBe(join(directory, "source.m4a"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("materializes imported cues as persistable transcript segments", () => {
    expect(materializeImportedSegments("run_1", [{ start: 1, end: 2, text: "内容" }]))
      .toEqual([{ id: "run_1_seg_1", runId: "run_1", start: 1, end: 2, text: "内容" }]);
  });
});
