import type { FastifyInstance } from "fastify";
import { DomainError } from "@videoanalyze/domain";

export type AuthServiceContract = {
  sendRegistrationCode(input: { email: string }): Promise<{ sent: true; expiresInSeconds: 600 }>;
  register(input: { email: string; password: string; confirmPassword: string; verificationCode: string }): Promise<{ userId: string; verified: true }>;
  verifyEmail(token: string): Promise<{ userId: string; trialCreditsGranted: boolean }>;
  login(input: { email: string; password: string }): Promise<{ sessionToken: string; user: unknown }>;
  authenticate(sessionToken: string): Promise<unknown>;
  logout(sessionToken: string): Promise<void>;
  forgotPassword?(input: { email: string }): Promise<{ ok: true }>;
  resetPassword?(input: { token: string; password: string; confirmPassword: string }): Promise<{ ok: true }>;
  changePassword?(input: { userId: string; password: string; confirmPassword: string }): Promise<{ ok: true }>;
};

const SESSION_COOKIE = "video_session";

export async function registerAuthRoutes(app: FastifyInstance, authService: AuthServiceContract, options: { secureCookies?: boolean } = {}) {
  app.post<{ Body: { email: string } }>("/api/auth/registration-code", async (request, reply) => {
    if (!request.body || typeof request.body.email !== "string") throw new DomainError("INVALID_CREDENTIALS", "email is required", 400);
    return reply.code(202).send(await authService.sendRegistrationCode({ email: request.body.email }));
  });

  app.post<{ Body: { email: string; password: string; confirmPassword: string; verificationCode: string } }>("/api/auth/register", async (request, reply) => {
    if (!request.body || typeof request.body.email !== "string" || typeof request.body.password !== "string" || typeof request.body.confirmPassword !== "string" || typeof request.body.verificationCode !== "string") throw new DomainError("INVALID_CREDENTIALS", "email, password, confirmation and verification code are required", 400);
    const result = await authService.register(request.body);
    return reply.code(202).send(result);
  });

  app.get<{ Querystring: { token?: string } }>("/api/auth/verify-email", async (request, reply) => {
    if (!request.query.token) return reply.code(400).send({ code: "INVALID_VERIFICATION_TOKEN", message: "token is required" });
    return reply.send(await authService.verifyEmail(request.query.token));
  });

  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (request, reply) => {
    if (!request.body || typeof request.body.email !== "string" || typeof request.body.password !== "string") throw new DomainError("INVALID_CREDENTIALS", "email and password are required", 400);
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

  app.post<{ Body: { email: string } }>("/api/auth/forgot-password", async (request, reply) => {
    if (!authService.forgotPassword) return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "password reset unavailable" });
    if (!request.body || typeof request.body.email !== "string") throw new DomainError("INVALID_CREDENTIALS", "email is required", 400);
    return reply.code(202).send(await authService.forgotPassword({ email: request.body.email }));
  });

  app.post<{ Body: { token: string; password: string; confirmPassword: string } }>("/api/auth/password-reset", async (request, reply) => {
    if (!authService.resetPassword) return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "password reset unavailable" });
    if (!request.body || typeof request.body.token !== "string" || typeof request.body.password !== "string" || typeof request.body.confirmPassword !== "string") throw new DomainError("INVALID_RESET_TOKEN", "token, password and confirmation are required", 400);
    const result = await authService.resetPassword(request.body);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send(result);
  });

  app.post<{ Body: { password: string; confirmPassword: string } }>("/api/auth/change-password", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (!sessionToken) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    const user = await authService.authenticate(sessionToken) as { id?: string };
    if (!user.id) return reply.code(401).send({ code: "UNAUTHORIZED", message: "login required" });
    if (!authService.changePassword) return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "password change unavailable" });
    if (!request.body || typeof request.body.password !== "string" || typeof request.body.confirmPassword !== "string") throw new DomainError("INVALID_CREDENTIALS", "password and confirmation are required", 400);
    return reply.send(await authService.changePassword({ userId: user.id, ...request.body }));
  });
}
