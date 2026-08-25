export type VideoLinkPlatform = "youtube" | "bilibili";

export type ParsedVideoLink = {
  platform: VideoLinkPlatform;
  externalId: string;
  part: number | null;
  canonicalUrl: string;
};

export function parseVideoLink(input: string): ParsedVideoLink | null {
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    const candidate = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.pathname.startsWith("/shorts/")
        ? url.pathname.split("/")[2]
        : url.searchParams.get("v");
    if (!candidate || !/^[A-Za-z0-9_-]{11}$/.test(candidate)) return null;
    return { platform: "youtube", externalId: candidate, part: null, canonicalUrl: `https://www.youtube.com/watch?v=${candidate}` };
  }

  if (["bilibili.com", "m.bilibili.com"].includes(host)) {
    const match = url.pathname.match(/\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})(?:\/|$)/);
    if (!match) return null;
    const externalId = match[1];
    const rawPart = Number(url.searchParams.get("p") ?? 1);
    const part = Number.isSafeInteger(rawPart) && rawPart > 1 ? rawPart : null;
    return { platform: "bilibili", externalId, part, canonicalUrl: `https://www.bilibili.com/video/${externalId}${part ? `?p=${part}` : ""}` };
  }
  return null;
}

export function timestampedVideoUrl(canonicalUrl: string, seconds: number): string {
  const source = parseVideoLink(canonicalUrl);
  if (!source) throw new Error("unsupported video link");
  const timestamp = Math.max(0, Math.floor(seconds));
  const url = new URL(source.canonicalUrl);
  url.searchParams.set("t", source.platform === "youtube" ? `${timestamp}s` : String(timestamp));
  return url.toString();
}
