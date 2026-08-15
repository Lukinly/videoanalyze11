import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";
import type { ResultService } from "../results/result-service.js";

export async function registerResultRoutes(app: FastifyInstance, dependencies: { authService: AuthServiceContract; resultService: ResultService }) {
  app.get<{ Querystring: { limit?: string } }>("/api/analysis-runs", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    return reply.send(await dependencies.resultService.list({ userId, limit: Number(request.query.limit ?? 50) }));
  });
  app.get<{ Params: { runId: string } }>("/api/analysis-runs/:runId", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    return reply.send(await dependencies.resultService.get({ userId, runId: request.params.runId }));
  });
  app.delete<{ Params: { runId: string } }>("/api/analysis-runs/:runId/results", async (request, reply) => {
    const userId = await authenticatedUserId(request, dependencies.authService);
    if (!userId) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    await dependencies.resultService.delete({ userId, runId: request.params.runId });
    return reply.code(204).send();
  });
}

async function authenticatedUserId(request: { cookies: Record<string, string | undefined> }, authService: AuthServiceContract) {
  const token = request.cookies.video_session;
  if (!token) return null;
  const user = await authService.authenticate(token) as { id?: string };
  return user.id ?? null;
}
