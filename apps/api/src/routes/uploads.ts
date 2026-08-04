import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";

type UploadServiceContract = {
  start(input: { userId: string; fileName: string; contentType: string; contentLength: number }): Promise<unknown>;
};

export async function registerUploadRoutes(app: FastifyInstance, dependencies: { authService: AuthServiceContract; uploadService: UploadServiceContract }) {
  app.post<{ Body: { fileName: string; contentType: string; contentLength: number } }>("/api/videos/upload-session", async (request, reply) => {
    const sessionToken = request.cookies.video_session;
    if (!sessionToken) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const user = await dependencies.authService.authenticate(sessionToken) as { id?: string };
    if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const result = await dependencies.uploadService.start({ userId: user.id, ...request.body });
    return reply.code(201).send(result);
  });
}
