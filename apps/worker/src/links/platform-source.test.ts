import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPlatformSourceLoader, materializeImportedSegments, parseWebVtt, parseBilibiliTimeline } from "./platform-source.js";

describe("remote platform transcripts", () => {
  it("converts WebVTT cues to monotonic transcript segments and removes tags", () => {
    const result = parseWebVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello <c.color>world</c>\n\n00:00:03.500 --> 00:00:05.000\nSecond line\n`);
    expect(result).toEqual([{ start: 1, end: 3.5, text: "Hello world" }, { start: 3.5, end: 5, text: "Second line" }]);
  });

  it("accepts bili-cli timeline cue shapes", () => {
    expect(parseBilibiliTimeline(JSON.stringify({ subtitles: [{ from: 2.1, to: 4.2, content: "第一句" }, { start: 4.2, end: 6, text: "第二句" }] })))
      .toEqual([{ start: 2.1, end: 4.2, text: "第一句" }, { start: 4.2, end: 6, text: "第二句" }]);
  });

  it("uses the part-aware Bilibili helper for a selected p", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const loader = createPlatformSourceLoader({ runner: { run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: JSON.stringify({ items: [{ from: 1, to: 2, content: "第三分P" }] }), stderr: "" };
    } } });
    await expect(loader.tryTranscript({ platform: "bilibili", url: "https://www.bilibili.com/video/BV1AB411c7mD?p=3", subtitleLanguage: "zh-CN" }, "/tmp/videoanalyze-test-subtitle"))
      .resolves.toEqual([{ start: 1, end: 2, text: "第三分P" }]);
    expect(calls[0]).toMatchObject({ command: "python3", args: ["/app/bilibili-part.py", "subtitle", "BV1AB411c7mD", "3"] });
  });

  it("uses the Bilibili helper to download audio from the default part", async () => {
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-bilibili-audio-"));
    const loader = createPlatformSourceLoader({ runner: { run: async (command: string, args: string[]) => {
      expect(command).toBe("python3");
      expect(args).toEqual(["/app/bilibili-part.py", "audio", "BV1Mo836fErR", "1", directory]);
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
