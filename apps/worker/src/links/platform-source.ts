import { mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createProcessRunner } from "../media/process-runner.js";

export type RemoteVideoSource = {
  platform: "youtube" | "bilibili";
  url: string;
  subtitleLanguage: string | null;
};
export type ImportedSegment = { start: number; end: number; text: string };

export function materializeImportedSegments(runId: string, segments: ImportedSegment[]) {
  return segments.map((segment, index) => ({ ...segment, id: `${runId}_seg_${index + 1}`, runId }));
}

export function createPlatformSourceLoader(input: { runner?: ReturnType<typeof createProcessRunner>; allowBrowserFallback?: boolean } = {}) {
  const runner = input.runner ?? createProcessRunner();
  const allowBrowserFallback = input.allowBrowserFallback ?? (process.env.BILIBILI_BROWSER_FALLBACK === "1" || (process.env.NODE_ENV === "development" && process.env.BILIBILI_BROWSER_FALLBACK !== "0"));
  return {
    async resolveFrameSource(source: RemoteVideoSource, signal?: AbortSignal): Promise<{ path: string; headers?: Record<string, string> }> {
      signal?.throwIfAborted();
      const command = source.platform === "bilibili" ? bilibiliSourceCommand("frames", source.url, "") : {
        command: "yt-dlp", args: ["--no-playlist", "--skip-download", "--dump-single-json", "-f",
          "bestvideo[height<=720]/best[height<=720]/bestvideo/best", "--", source.url]
      };
      const result = await runner.run(command.command, command.args, { signal, timeoutMs: 45_000, maxOutputBytes: 8 * 1024 * 1024 });
      const payload = JSON.parse(result.stdout) as { url?: string; http_headers?: Record<string, string> };
      if (!payload.url || !/^https?:\/\//.test(payload.url)) throw new Error("platform video frames are unavailable");
      return { path: payload.url, headers: payload.http_headers };
    },
    async tryTranscript(source: RemoteVideoSource, directory: string, signal?: AbortSignal): Promise<ImportedSegment[] | null> {
      if (!source.subtitleLanguage) return null;
      await mkdir(directory, { recursive: true });
      if (source.platform === "bilibili") {
        try {
          const command = bilibiliSourceCommand("subtitle", source.url, directory);
          const result = await runner.run(command.command, command.args, { signal, timeoutMs: 120_000, maxOutputBytes: 8 * 1024 * 1024 });
          const segments = parseBilibiliTimeline(result.stdout);
          if (segments.length) return segments;
        } catch (error) { if (signal?.aborted) throw error; }
        if (allowBrowserFallback) {
          try {
            const url = new URL(source.url);
            const bvid = url.pathname.split("/").filter(Boolean).at(-1)!;
            const result = await runner.run("opencli", ["bilibili", "subtitle", bvid, "--page", url.searchParams.get("p") ?? "1", "-f", "json"], { signal, timeoutMs: 120_000, maxOutputBytes: 8 * 1024 * 1024 });
            const segments = parseBilibiliTimeline(result.stdout);
            return segments.length ? segments : null;
          } catch (error) { if (signal?.aborted) throw error; }
        }
        return null;
      }
      try {
        await runner.run("yt-dlp", ["--skip-download", "--no-playlist", "--write-sub", "--write-auto-sub", "--sub-langs", source.subtitleLanguage,
          "--sub-format", "vtt", "-o", join(directory, "subtitle.%(ext)s"), "--", source.url], { signal, timeoutMs: 120_000, maxOutputBytes: 8 * 1024 * 1024 });
        const subtitle = (await listFiles(directory)).find((path) => path.endsWith(".vtt"));
        if (!subtitle) return null;
        const segments = parseWebVtt(await readFile(subtitle, "utf8"));
        return segments.length ? segments : null;
      } catch (error) { if (signal?.aborted) throw error; return null; }
    },
    async downloadAudio(source: RemoteVideoSource, directory: string, signal?: AbortSignal): Promise<string> {
      await mkdir(directory, { recursive: true });
      if (source.platform === "youtube") {
        await runner.run("yt-dlp", ["-x", "--audio-format", "m4a", "--audio-quality", "0", "--no-playlist", "--max-filesize", "536870912",
          "-o", join(directory, "source.%(ext)s"), "--", source.url], { signal, timeoutMs: 15 * 60_000, maxOutputBytes: 8 * 1024 * 1024 });
      } else {
        const command = bilibiliSourceCommand("audio", source.url, directory);
        await runner.run(command.command, command.args, { signal, timeoutMs: 15 * 60_000, maxOutputBytes: 8 * 1024 * 1024 });
      }
      const audio = (await listFiles(directory)).find((path) => /\.(m4a|mp3|aac|wav|flac|webm)$/i.test(path));
      if (!audio) throw new Error("platform downloader produced no audio");
      return audio;
    }
  };
}

export function bilibiliSourceCommand(mode: "subtitle" | "audio" | "frames", rawUrl: string, directory: string) {
  const url = new URL(rawUrl);
  const part = Number(url.searchParams.get("p") ?? 1);
  const bvid = url.pathname.match(/\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})(?:\/|$)/)?.[1];
  if (!bvid || !Number.isSafeInteger(part) || part < 1) throw new Error("invalid Bilibili source URL");
  if (mode === "audio" || mode === "frames" || part > 1) {
    const args = [process.env.BILIBILI_PART_HELPER ?? fileURLToPath(new URL("../../scripts/bilibili-part.py", import.meta.url)), mode, bvid, String(part)];
    if (mode === "audio") args.push(directory);
    return { command: "python3", args };
  }
  return mode === "subtitle"
    ? { command: "bili", args: ["video", rawUrl, "--subtitle-timeline", "--json"] }
    : { command: "bili", args: ["audio", rawUrl, "--no-split", "--output", directory] };
}

export function parseWebVtt(value: string): ImportedSegment[] {
  const lines = value.replace(/\r/g, "").split("\n");
  const result: ImportedSegment[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/);
    if (!match) continue;
    const text: string[] = [];
    while (++index < lines.length && lines[index].trim()) text.push(lines[index].replace(/<[^>]+>/g, "").trim());
    const start = parseTimestamp(match[1]); const end = parseTimestamp(match[2]); const joined = text.join(" ").replace(/\s+/g, " ").trim();
    if (joined && end > start && result.at(-1)?.text !== joined) result.push({ start, end, text: joined });
  }
  return result;
}

export function parseBilibiliTimeline(value: string): ImportedSegment[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return []; }
  const cues = findCueArray(parsed);
  if (!cues) return [];
  return cues.flatMap((cue) => {
    const start = parseCueSeconds(cue.from ?? cue.start ?? cue.start_time); const end = parseCueSeconds(cue.to ?? cue.end ?? cue.end_time);
    const text = String(cue.content ?? cue.text ?? cue.body ?? "").trim();
    return Number.isFinite(start) && Number.isFinite(end) && end > start && text ? [{ start, end, text }] : [];
  });
}

function parseCueSeconds(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?s?$/.test(value.trim())) return Number(value.trim().replace(/s$/, ""));
  return Number.NaN;
}

function findCueArray(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value) && value.some((item) => typeof item === "object" && item && ("from" in item || "start" in item))) return value as Array<Record<string, unknown>>;
  if (typeof value !== "object" || value === null) return null;
  for (const child of Object.values(value)) { const found = findCueArray(child); if (found) return found; }
  return null;
}
function parseTimestamp(value: string) { const parts = value.split(":").map(Number); return parts.reduce((total, part) => total * 60 + part, 0); }
async function listFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path)); else result.push(path);
  }
  return result;
}
