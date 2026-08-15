import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";
import { DomainError } from "@videoanalyze/domain";

export type MediaService = {
  getPlaybackUrl(input: { userId: string; videoId: string }): Promise<string>;
  reportPlaybackValidation?(input: { userId: string; videoId: string; loadedMetadata: boolean; canPlay: boolean; seekWorked: boolean }): Promise<void>;
};

export function createMediaService(dependencies: {
  videos: { findOwnedById(userId: string, videoId: string): Promise<{ objectKey: string; originalDeletedAt?: Date | null } | null> };
  storage: { getDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> };
}): MediaService {
  return {
    async getPlaybackUrl(input) {
      const video = await dependencies.videos.findOwnedById(input.userId, input.videoId);
      if (!video) throw new DomainError("NOT_FOUND", "video not found", 404);
      if (video.originalDeletedAt) throw new DomainError("ORIGINAL_DELETED", "original video deleted", 410);
      return dependencies.storage.getDownloadUrl(video.objectKey, 900);
    }
  };
}

export async function registerMediaRoutes(app: FastifyInstance, dependencies: { authService: AuthServiceContract; mediaService: MediaService }) {
  app.get<{ Params: { videoId: string } }>("/api/videos/:videoId/playback-url", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    return reply.send({ url: await dependencies.mediaService.getPlaybackUrl({ userId, videoId: request.params.videoId }) });
  });

  app.post<{ Params: { videoId: string }; Body: { loadedMetadata: boolean; canPlay: boolean; seekWorked: boolean } }>("/api/videos/:videoId/playback-validation", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    await dependencies.mediaService.reportPlaybackValidation?.({ userId, videoId: request.params.videoId, ...request.body });
    return reply.code(202).send({ accepted: true });
  });
}

async function authenticatedUserId(request: { cookies: Record<string, string | undefined> }, authService: AuthServiceContract): Promise<string | null> {
  const token = request.cookies.video_session;
  if (!token) return null;
  const user = await authService.authenticate(token) as { id?: string };
  return user.id ?? null;
}
