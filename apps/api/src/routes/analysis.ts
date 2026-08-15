import type { FastifyInstance } from "fastify";
import { retentionModeSchema, type RetentionMode } from "@videoanalyze/domain";
import type { AuthServiceContract } from "./auth.js";
import type { ProgressEvent } from "../events/progress-hub.js";

export type AnalysisServiceContract = {
  start(input: { userId: string; videoId: string; retentionMode: RetentionMode }): Promise<unknown>;
  get(input: { userId: string; runId: string }): Promise<unknown & { id?: string }>;
  cancel(input: { userId: string; runId: string }): Promise<unknown>;
};

type ProgressHub = {
  subscribe(runId: string, subscriber: (event: ProgressEvent) => void): () => void;
};

export async function registerAnalysisRoutes(app: FastifyInstance, dependencies: { authService: AuthServiceContract; analysisService: AnalysisServiceContract; progressHub: ProgressHub; registerDetailRoute?: boolean }) {
  app.post<{ Params: { videoId: string }; Body: { retentionMode?: unknown } }>("/api/videos/:videoId/analysis-runs", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const retentionMode = retentionModeSchema.safeParse(request.body?.retentionMode ?? "standard");
    if (!retentionMode.success) {
      return reply.code(400).send({ code: "INVALID_RETENTION_MODE", message: "retentionMode must be standard or privacy" });
    }
    return reply.code(202).send(await dependencies.analysisService.start({ userId, videoId: request.params.videoId, retentionMode: retentionMode.data }));
  });

  if (dependencies.registerDetailRoute !== false) {
    app.get<{ Params: { runId: string } }>("/api/analysis-runs/:runId", async (request, reply) => {
      const userId = await authenticatedUserId(request, dependencies.authService);
      if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
      return reply.send(await dependencies.analysisService.get({ userId, runId: request.params.runId }));
    });
  }

  app.post<{ Params: { runId: string } }>("/api/analysis-runs/:runId/cancel", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    return reply.code(202).send(await dependencies.analysisService.cancel({ userId, runId: request.params.runId }));
  });

  app.get<{ Params: { runId: string } }>("/api/analysis-runs/:runId/events", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const run = await dependencies.analysisService.get({ userId, runId: request.params.runId });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const unsubscribe = dependencies.progressHub.subscribe(request.params.runId, (event) => {
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ runId: run.id })}\n\n`);
    request.raw.on("close", unsubscribe);
  });
}

async function authenticatedUserId(request: { cookies: Record<string, string | undefined> }, authService: AuthServiceContract): Promise<string | null> {
  const token = request.cookies.video_session;
  if (!token) return null;
  const user = await authService.authenticate(token) as { id?: string };
  return user.id ?? null;
}
