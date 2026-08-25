import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";

export type LinkImportServiceContract = {
  preview(input: { userId: string; url: string }): Promise<unknown>;
  confirm(input: { userId: string; url: string }): Promise<unknown>;
};

export async function registerLinkImportRoutes(app: FastifyInstance, input: { authService: Pick<AuthServiceContract, "authenticate">; linkImportService: LinkImportServiceContract }) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  const allow = (userId: string) => {
    const now = Date.now(); const current = windows.get(userId);
    if (!current || now - current.startedAt >= 60_000) { windows.set(userId, { startedAt: now, count: 1 }); return true; }
    current.count += 1; return current.count <= 12;
  };
  app.post<{ Body: { url?: unknown } }>("/api/link-imports/preview", async (request, reply) => {
    const token = request.cookies.video_session;
    if (!token) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const user = await input.authService.authenticate(token) as { id?: string };
    if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    if (!allow(user.id)) return reply.code(429).send({ code: "RATE_LIMITED", message: "too many link requests; try again shortly" });
    if (typeof request.body?.url !== "string" || !request.body.url.trim() || request.body.url.length > 2048) {
      return reply.code(400).send({ code: "UNSUPPORTED_MEDIA", message: "a valid video URL is required" });
    }
    return reply.send(await input.linkImportService.preview({ userId: user.id, url: request.body.url.trim() }));
  });
  app.post<{ Body: { url?: unknown } }>("/api/link-imports/confirm", async (request, reply) => {
    const token = request.cookies.video_session;
    if (!token) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const user = await input.authService.authenticate(token) as { id?: string };
    if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    if (!allow(user.id)) return reply.code(429).send({ code: "RATE_LIMITED", message: "too many link requests; try again shortly" });
    if (typeof request.body?.url !== "string" || !request.body.url.trim() || request.body.url.length > 2048) {
      return reply.code(400).send({ code: "UNSUPPORTED_MEDIA", message: "a valid video URL is required" });
    }
    return reply.send(await input.linkImportService.confirm({ userId: user.id, url: request.body.url.trim() }));
  });
}
