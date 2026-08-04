import type { FastifyInstance } from "fastify";

export type AuthServiceContract = {
  register(input: { email: string; password: string }): Promise<{ userId: string; verificationSent: boolean }>;
  verifyEmail(token: string): Promise<{ userId: string; trialCreditsGranted: boolean }>;
  login(input: { email: string; password: string }): Promise<{ sessionToken: string; user: unknown }>;
  authenticate(sessionToken: string): Promise<unknown>;
  logout(sessionToken: string): Promise<void>;
};

const SESSION_COOKIE = "video_session";

export async function registerAuthRoutes(app: FastifyInstance, authService: AuthServiceContract, options: { secureCookies?: boolean } = {}) {
  app.post<{ Body: { email: string; password: string } }>("/api/auth/register", async (request, reply) => {
    const result = await authService.register(request.body);
    return reply.code(202).send(result);
  });

  app.get<{ Querystring: { token?: string } }>("/api/auth/verify-email", async (request, reply) => {
    if (!request.query.token) return reply.code(400).send({ code: "INVALID_VERIFICATION_TOKEN", message: "token is required" });
    return reply.send(await authService.verifyEmail(request.query.token));
  });

  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (request, reply) => {
    const result = await authService.login(request.body);
    reply.setCookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: options.secureCookies ?? process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60
    });
    return reply.send({ user: result.user });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (!sessionToken) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    return reply.send(await authService.authenticate(sessionToken));
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (sessionToken) await authService.logout(sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}
