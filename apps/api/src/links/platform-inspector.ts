import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DomainError, parseVideoLink, type ParsedVideoLink } from "@videoanalyze/domain";
import type { LinkMetadata } from "./link-import-service.js";

const execFileAsync = promisify(execFile);
type CommandRunner = (command: string, args: string[]) => Promise<string>;
type BilibiliViewFetcher = (bvid: string) => Promise<Record<string, unknown>>;
type RedirectFetcher = (input: URL, init: RequestInit) => Promise<Response>;

export function createPlatformInspector(input: { run?: CommandRunner; resolveShortUrl?: (url: string) => Promise<string>; fetchBilibiliView?: BilibiliViewFetcher; maxConcurrent?: number } = {}) {
  const run = input.run ?? runCommand;
  const limit = createConcurrencyLimit(input.maxConcurrent ?? 4);
  return {
    async inspect(rawUrl: string): Promise<LinkMetadata & { subtitleKind?: "manual" | "automatic" | null }> {
      return limit(async () => {
        let parsed = parseVideoLink(rawUrl);
        if (!parsed && isBilibiliShortLink(rawUrl)) parsed = parseVideoLink(await (input.resolveShortUrl ?? resolveBilibiliShortUrl)(rawUrl));
        if (!parsed) throw new DomainError("UNSUPPORTED_MEDIA", "only public YouTube and Bilibili video links are supported", 422);
        try {
          return await (parsed.platform === "youtube" ? inspectYouTube(parsed, run) : inspectBilibili(parsed, run, input.fetchBilibiliView ?? fetchBilibiliView));
        } catch (error) {
          if (error instanceof DomainError) throw error;
          throw new DomainError("UNSUPPORTED_MEDIA", `could not read public video metadata: ${safeMessage(error)}`, 422);
        }
      });
    }
  };
}

async function inspectYouTube(source: ParsedVideoLink, run: CommandRunner) {
  const data = JSON.parse(await run("yt-dlp", ["--dump-single-json", "--no-playlist", "--", source.canonicalUrl])) as Record<string, unknown>;
  const languages = [stringValue(data.original_language), stringValue(data.language)].filter((value): value is string => Boolean(value));
  const subtitles = objectValue(data.subtitles);
  const automatic = objectValue(data.automatic_captions);
  const manualLanguage = chooseLanguage(subtitles, languages);
  const automaticLanguage = manualLanguage ? null : chooseLanguage(automatic, languages);
  const liveStatus = String(data.live_status ?? "not_live");
  return {
    ...source,
    title: requiredString(data.title, "video title"),
    author: stringValue(data.uploader) ?? stringValue(data.channel) ?? "",
    duration: numberValue(data.duration),
    thumbnailUrl: stringValue(data.thumbnail) ?? "",
    isLive: ["is_live", "is_upcoming", "post_live"].includes(liveStatus),
    subtitleLanguage: manualLanguage ?? automaticLanguage,
    subtitleKind: manualLanguage ? "manual" as const : automaticLanguage ? "automatic" as const : null
  };
}

async function inspectBilibili(source: ParsedVideoLink, run: CommandRunner, fetchView: BilibiliViewFetcher) {
  const root = JSON.parse(await run("bili", ["video", source.canonicalUrl, "--json"])) as Record<string, unknown>;
  const data = objectValue(root.data) ?? root;
  const video = objectValue(data.video) ?? data;
  const view = await fetchView(source.externalId);
  const pages = Array.isArray(view.pages) ? view.pages as Array<Record<string, unknown>> : [];
  const selectedPage = source.part ? pages.find((page) => Number(page.page) === source.part) : pages[0];
  if (source.part && !selectedPage) throw new Error(`video part p=${source.part} is unavailable`);
  const owner = objectValue(video.owner);
  const subtitle = objectValue(data.subtitle);
  const baseTitle = requiredString(video.title, "video title");
  const partTitle = source.part && selectedPage ? stringValue(selectedPage.part) : null;
  return {
    ...source,
    title: partTitle ? `${baseTitle} · ${partTitle}` : baseTitle,
    author: stringValue(owner?.name) ?? stringValue(video.author) ?? "",
    duration: numberValue(selectedPage?.duration ?? video.duration_seconds ?? video.duration),
    thumbnailUrl: stringValue(view.pic) ?? stringValue(video.pic) ?? stringValue(video.cover) ?? "",
    isLive: Boolean(video.is_live),
    subtitleLanguage: stringValue(subtitle?.language) ?? "zh-CN",
    subtitleKind: subtitle?.available || video.has_subtitle ? "manual" as const : null
  };
}

async function runCommand(command: string, args: string[]) {
  const result = await execFileAsync(command, args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
  return result.stdout;
}

export async function resolveBilibiliShortUrl(url: string, fetcher: RedirectFetcher = fetch) {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop += 1) {
    if (!isAllowedBilibiliRedirectHost(current)) throw new Error("short link has an unsafe redirect destination");
    const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "videoanalyze/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("short link redirect is missing a destination");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`short link returned HTTP ${response.status}`);
    if (!parseVideoLink(current.toString())) throw new Error("short link did not resolve to a supported Bilibili video");
    return current.toString();
  }
  throw new Error("short link redirected too many times");
}

async function fetchBilibiliView(bvid: string) {
  const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
  endpoint.searchParams.set("bvid", bvid);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 videoanalyze/1.0", Referer: `https://www.bilibili.com/video/${bvid}` } });
  if (!response.ok) throw new Error(`Bilibili metadata returned HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const data = objectValue(payload.data);
  if (Number(payload.code) !== 0 || !data) throw new Error("Bilibili metadata is unavailable");
  return data;
}

function isBilibiliShortLink(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.hostname.toLowerCase() === "b23.tv" && !url.username && !url.password; }
  catch { return false; }
}
function isAllowedBilibiliRedirectHost(url: URL) {
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    && ["b23.tv", "bilibili.com", "www.bilibili.com", "m.bilibili.com"].includes(url.hostname.toLowerCase());
}
function objectValue(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function requiredString(value: unknown, label: string) { const result = stringValue(value); if (!result) throw new Error(`${label} is unavailable`); return result; }
function numberValue(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new Error("video duration is unavailable"); return result; }
function chooseLanguage(tracks: Record<string, unknown> | null, preferred: string[]) {
  if (!tracks) return null;
  const languages = Object.keys(tracks).filter((key) => key !== "live_chat" && Array.isArray(tracks[key]) && (tracks[key] as unknown[]).length > 0).sort();
  for (const candidate of preferred) {
    const normalized = candidate.toLowerCase();
    const exact = languages.find((language) => language.toLowerCase() === normalized);
    if (exact) return exact;
    const base = normalized.split("-")[0];
    const related = languages.find((language) => language.toLowerCase().split("-")[0] === base);
    if (related) return related;
  }
  return languages[0] ?? null;
}
function safeMessage(error: unknown) {
  if (!(error instanceof Error)) return "metadata lookup failed";
  return Array.from(error.message).map((character) => character.charCodeAt(0) < 32 ? " " : character).join("").replace(/\s+/g, " ").slice(0, 240);
}

function createConcurrencyLimit(maxConcurrent: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try { return await operation(); }
    finally { active -= 1; waiting.shift()?.(); }
  };
}
