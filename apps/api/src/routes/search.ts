import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";
import type { SearchService } from "../search/search-service.js";

export async function registerSearchRoutes(app: FastifyInstance, dependencies: { authService: AuthServiceContract; searchService: SearchService }) {
  app.get<{ Params: { runId: string }; Querystring: { q?: string; limit?: string } }>("/api/analysis-runs/:runId/search", async (request, reply) => {
    const sessionToken = request.cookies.video_session;
    if (!sessionToken) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const user = await dependencies.authService.authenticate(sessionToken) as { id?: string };
    if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const results = await dependencies.searchService.query({
      userId: user.id,
      runId: request.params.runId,
      query: request.query.q ?? "",
      limit: Number(request.query.limit ?? 20)
    });
    return reply.send({ results });
  });
}
