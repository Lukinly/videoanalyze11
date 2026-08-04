import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { DomainError } from "@videoanalyze/domain";
import { registerAuthRoutes, type AuthServiceContract } from "./routes/auth.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerAnalysisRoutes, type AnalysisServiceContract } from "./routes/analysis.js";
import { createProgressHub } from "./events/progress-hub.js";
import { registerHealthRoutes, type ReadinessChecks } from "./routes/health.js";
import { registerSearchRoutes } from "./routes/search.js";
import type { SearchService } from "./search/search-service.js";
import { registerMediaRoutes, type MediaService } from "./routes/media.js";
import { deleteVideo } from "./routes/videos-delete.js";

export function buildApp(dependencies: {
  authService: AuthServiceContract;
  uploadService?: { start(input: { userId: string; fileName: string; contentType: string; contentLength: number }): Promise<unknown> };
  analysisService?: AnalysisServiceContract;
  progressHub?: ReturnType<typeof createProgressHub>;
  readinessChecks?: ReadinessChecks;
  searchService?: SearchService;
  mediaService?: MediaService;
  videoDeletion?: { videos: { listOwnedObjectKeys(userId: string, videoId: string): Promise<string[] | null>; markDeleted(userId: string, videoId: string): Promise<void> }; storage: { delete(key: string): Promise<void> } };
}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cookie);
  app.register(async (instance) => registerHealthRoutes(instance, dependencies.readinessChecks));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.status).send({ code: error.code, message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "internal server error" });
  });

  app.register(async (instance) => registerAuthRoutes(instance, dependencies.authService));
  if (dependencies.uploadService) {
    app.register(async (instance) => registerUploadRoutes(instance, { authService: dependencies.authService, uploadService: dependencies.uploadService! }));
  }
  if (dependencies.analysisService) {
    app.register(async (instance) => registerAnalysisRoutes(instance, { authService: dependencies.authService, analysisService: dependencies.analysisService!, progressHub: dependencies.progressHub ?? createProgressHub() }));
  }
  if (dependencies.searchService) {
    app.register(async (instance) => registerSearchRoutes(instance, { authService: dependencies.authService, searchService: dependencies.searchService! }));
  }
  if (dependencies.mediaService) {
    app.register(async (instance) => registerMediaRoutes(instance, { authService: dependencies.authService, mediaService: dependencies.mediaService! }));
  }
  if (dependencies.videoDeletion) {
    app.delete<{ Params: { videoId: string } }>("/api/videos/:videoId", async (request, reply) => {
      const sessionToken = request.cookies.video_session;
      if (!sessionToken) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
      const user = await dependencies.authService.authenticate(sessionToken) as { id?: string };
      if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
      const deleted = await deleteVideo({ userId: user.id, videoId: request.params.videoId, ...dependencies.videoDeletion! });
      return deleted ? reply.code(204).send() : reply.code(404).send({ code: "NOT_FOUND", message: "video not found" });
    });
  }
  return app;
}
