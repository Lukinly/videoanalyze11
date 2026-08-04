import type { FastifyInstance } from "fastify";

export type ReadinessChecks = {
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
  storage?: () => Promise<void>;
};

export async function registerHealthRoutes(app: FastifyInstance, checks: ReadinessChecks = {}) {
  app.get("/healthz", async (_request, reply) => reply.send({ status: "ok", service: "api" }));

  app.get("/readyz", async (_request, reply) => {
    const dependencyChecks: Record<"database" | "redis" | "storage", (() => Promise<void>) | undefined> = {
      database: checks.database,
      redis: checks.redis,
      storage: checks.storage
    };
    const results = await Promise.all(Object.entries(dependencyChecks).map(async ([name, check]) => {
      if (!check) return [name, "ok"] as const;
      try {
        await check();
        return [name, "ok"] as const;
      } catch {
        return [name, "error"] as const;
      }
    }));
    const dependencies = Object.fromEntries(results) as Record<string, "ok" | "error">;
    const ready = Object.values(dependencies).every((status) => status === "ok");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", dependencies });
  });
}
