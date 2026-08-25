import { calculateDurationTieredCredits, DomainError, MAX_VIDEO_DURATION_SECONDS, type VideoLinkPlatform } from "@videoanalyze/domain";

export type LinkMetadata = {
  platform: VideoLinkPlatform;
  externalId: string;
  part: number | null;
  canonicalUrl: string;
  title: string;
  author: string;
  duration: number;
  thumbnailUrl: string;
  isLive: boolean;
  subtitleLanguage: string | null;
  subtitleKind?: "manual" | "automatic" | null;
};

type ExistingSource = { videoId: string; runId: string | null; runStatus: string | null };
type LinkVideoInput = LinkMetadata & { userId: string };

export function createLinkImportService(input: {
  inspector: { inspect(url: string): Promise<LinkMetadata> };
  repository: {
    findOwnedBySource(userId: string, platform: VideoLinkPlatform, externalId: string, part: number | null): Promise<ExistingSource | null>;
    createLinkVideo(value: LinkVideoInput): Promise<{ id: string }>;
  };
}) {
  async function inspect(value: { userId: string; url: string }) {
    const metadata = await input.inspector.inspect(value.url);
    if (metadata.isLive) throw new DomainError("UNSUPPORTED_MEDIA", "live video is not supported", 422);
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new DomainError("UNSUPPORTED_MEDIA", "video duration is unavailable", 422);
    if (metadata.duration > MAX_VIDEO_DURATION_SECONDS) throw new DomainError("VIDEO_TOO_LONG", "video exceeds the four-hour limit", 422);
    const billing = calculateDurationTieredCredits(metadata.duration);
    const existing = await input.repository.findOwnedBySource(value.userId, metadata.platform, metadata.externalId, metadata.part);
    return { metadata, billing, existing };
  }
  return {
    async preview(value: { userId: string; url: string }) {
      const { metadata, billing, existing } = await inspect(value);
      if (existing) return { videoId: existing.videoId, existingRunId: existing.runId, duplicateStatus: existing.runStatus, ...metadata, estimatedCost: billing.reservedCredits, billing };
      return { videoId: null, existingRunId: null, duplicateStatus: null, ...metadata, estimatedCost: billing.reservedCredits, billing };
    },
    async confirm(value: { userId: string; url: string }) {
      const { metadata, billing, existing } = await inspect(value);
      const videoId = existing?.videoId ?? (await input.repository.createLinkVideo({ userId: value.userId, ...metadata })).id;
      return { videoId, existingRunId: existing?.runId ?? null, duplicateStatus: existing?.runStatus ?? null, ...metadata, estimatedCost: billing.reservedCredits, billing };
    }
  };
}

export type LinkImportService = ReturnType<typeof createLinkImportService>;
