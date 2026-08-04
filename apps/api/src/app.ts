import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { DomainError } from "@videoanalyze/domain";
import { registerAuthRoutes, type AuthServiceContract } from "./routes/auth.js";

export function buildApp(dependencies: { authService: AuthServiceContract }): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.status).send({ code: error.code, message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "internal server error" });
  });

  app.register(async (instance) => registerAuthRoutes(instance, dependencies.authService));
  return app;
}
