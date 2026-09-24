import type { FastifyInstance } from "fastify";
import type { AuthServiceContract } from "./auth.js";
import { requireAuthenticated } from "../auth/authorization.js";

type CreditRoutesDependencies = {
  authService: AuthServiceContract;
  credits: {
    getBalance(userId: string): Promise<{ ledgerBalance: number; held: number; available: number }>;
    listLedger(userId: string, limit?: number): Promise<unknown[]>;
  };
  topups: {
    createTopup(input: { userId: string; requestedAmount: number; note: string }): Promise<unknown>;
    listTopups(input: { userId: string; limit?: number; offset?: number }): Promise<unknown[]>;
  };
};

export async function registerCreditRoutes(app: FastifyInstance, dependencies: CreditRoutesDependencies) {
  app.get("/api/credits", async (request, reply) => {
    const user = await requireAuthenticated(request, dependencies.authService);
    return reply.send(await dependencies.credits.getBalance(user.id));
  });

  app.get<{ Querystring: { limit?: string } }>("/api/credits/ledger", async (request, reply) => {
    const user = await requireAuthenticated(request, dependencies.authService);
    return reply.send({ items: await dependencies.credits.listLedger(user.id, parsePageSize(request.query.limit)) });
  });

  app.post<{ Body: { requestedAmount: number; note?: string } }>("/api/credit-requests", async (request, reply) => {
    const user = await requireAuthenticated(request, dependencies.authService);
    const amount = request.body?.requestedAmount;
    if (!Number.isSafeInteger(amount) || amount <= 0) return reply.code(400).send({ code: "INVALID_CREDIT_REQUEST", message: "requested amount must be a positive integer" });
    return reply.code(201).send(await dependencies.topups.createTopup({ userId: user.id, requestedAmount: amount, note: String(request.body.note ?? "") }));
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/credit-requests", async (request, reply) => {
    const user = await requireAuthenticated(request, dependencies.authService);
    return reply.send({ items: await dependencies.topups.listTopups({ userId: user.id, limit: parsePageSize(request.query.limit), offset: parseOffset(request.query.offset) }) });
  });
}

function parsePageSize(value?: string): number {
  const parsed = Number(value ?? 50);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
}

function parseOffset(value?: string): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
