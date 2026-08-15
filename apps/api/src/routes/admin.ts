import type { FastifyInstance } from "fastify";
import { DomainError } from "@videoanalyze/domain";
import type { AuthServiceContract } from "./auth.js";
import { requireAdmin } from "../auth/authorization.js";
import type { AdminTopupRecord } from "../db/repositories/admin.js";

type AdminRoutesDependencies = {
  authService: AuthServiceContract & { requestPasswordReset?: (userId: string) => Promise<{ token: string; expiresAt: Date }> };
  users: {
    list(input: { search?: string; status?: "active" | "suspended"; limit?: number; offset?: number }): Promise<Array<{ id: string; email: string; emailVerifiedAt: Date | null; role: "user" | "admin"; status: "active" | "suspended"; mustChangePassword: boolean }>>;
    findById(id: string): Promise<{ id: string; email: string; emailVerifiedAt: Date | null; role: "user" | "admin"; status: "active" | "suspended"; mustChangePassword: boolean } | null>;
    setRole(id: string, role: "user" | "admin"): Promise<void>;
    setStatus(id: string, status: "active" | "suspended"): Promise<void>;
    setMustChangePassword(id: string, value: boolean): Promise<void>;
  };
  credits: {
    getBalance(userId: string): Promise<{ ledgerBalance: number; held: number; available: number }>;
    listLedger(userId: string, limit?: number): Promise<unknown[]>;
  };
  adminRepository: {
    listTopups(input?: { status?: "pending" | "approved" | "rejected"; limit?: number; offset?: number }): Promise<AdminTopupRecord[]>;
    approveTopup(input: { requestId: string; adminUserId: string; reviewNote: string }): Promise<unknown>;
    rejectTopup(input: { requestId: string; adminUserId: string; reviewNote: string }): Promise<unknown>;
    adjustCredits(input: { targetUserId: string; adminUserId: string; amount: number; type: "admin_grant" | "admin_debit"; reason: string; idempotencyKey: string }): Promise<void>;
    createAudit(input: { adminUserId: string; action: string; targetUserId?: string; targetRecordId?: string; metadata?: Record<string, unknown>; reason: string }): Promise<void>;
    listAudit(input?: { limit?: number; offset?: number }): Promise<unknown[]>;
  };
};

export async function registerAdminRoutes(app: FastifyInstance, dependencies: AdminRoutesDependencies) {
  app.get<{ Querystring: { search?: string; status?: "active" | "suspended"; limit?: string; offset?: string } }>("/api/admin/users", async (request, reply) => {
    await requireAdmin(request, dependencies.authService);
    const users = await dependencies.users.list({ search: request.query.search, status: request.query.status, limit: pageSize(request.query.limit), offset: offset(request.query.offset) });
    const items = await Promise.all(users.map(async (user) => ({
      ...publicUser(user),
      ...(await dependencies.credits.getBalance(user.id))
    })));
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>("/api/admin/users/:id", async (request, reply) => {
    await requireAdmin(request, dependencies.authService);
    const user = await dependencies.users.findById(request.params.id);
    if (!user) throw new DomainError("NOT_FOUND", "user not found", 404);
    return reply.send({ user: publicUser(user), balance: await dependencies.credits.getBalance(user.id), ledger: await dependencies.credits.listLedger(user.id, 100) });
  });

  app.patch<{ Params: { id: string }; Body: { role: "user" | "admin"; reason: string } }>("/api/admin/users/:id/role", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    if (!request.body?.reason?.trim() || !["user", "admin"].includes(request.body.role)) throw new DomainError("INVALID_REASON", "role and reason are required", 400);
    await dependencies.users.setRole(request.params.id, request.body.role);
    await dependencies.adminRepository.createAudit({ adminUserId: admin.id, action: "change_role", targetUserId: request.params.id, metadata: { role: request.body.role }, reason: request.body.reason });
    return reply.send({ ok: true });
  });

  app.patch<{ Params: { id: string }; Body: { status: "active" | "suspended"; reason: string } }>("/api/admin/users/:id/status", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    if (!request.body?.reason?.trim() || !["active", "suspended"].includes(request.body.status)) throw new DomainError("INVALID_REASON", "status and reason are required", 400);
    await dependencies.users.setStatus(request.params.id, request.body.status);
    await dependencies.adminRepository.createAudit({ adminUserId: admin.id, action: "change_status", targetUserId: request.params.id, metadata: { status: request.body.status }, reason: request.body.reason });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string }; Body: { direction: "grant" | "debit"; amount: number; reason: string; idempotencyKey: string } }>("/api/admin/users/:id/credits", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    const body = request.body;
    if (!body || !["grant", "debit"].includes(body.direction) || !Number.isSafeInteger(body.amount) || body.amount <= 0 || !body.reason?.trim() || !body.idempotencyKey?.trim()) throw new DomainError("INVALID_CREDIT_REQUEST", "direction, positive amount, reason and idempotencyKey are required", 400);
    await dependencies.adminRepository.adjustCredits({ targetUserId: request.params.id, adminUserId: admin.id, amount: body.amount, type: body.direction === "grant" ? "admin_grant" : "admin_debit", reason: body.reason, idempotencyKey: body.idempotencyKey });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/api/admin/users/:id/force-password-reset", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    if (!dependencies.authService.requestPasswordReset) return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "password reset unavailable" });
    await dependencies.users.setMustChangePassword(request.params.id, true);
    await dependencies.authService.requestPasswordReset(request.params.id);
    await dependencies.adminRepository.createAudit({ adminUserId: admin.id, action: "force_password_reset", targetUserId: request.params.id, reason: "administrator requested password reset" });
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { status?: "pending" | "approved" | "rejected"; limit?: string; offset?: string } }>("/api/admin/credit-requests", async (request, reply) => {
    await requireAdmin(request, dependencies.authService);
    return reply.send({ items: await dependencies.adminRepository.listTopups({ status: request.query.status, limit: pageSize(request.query.limit), offset: offset(request.query.offset) }) });
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>("/api/admin/credit-requests/:id/approve", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    return reply.send(await dependencies.adminRepository.approveTopup({ requestId: request.params.id, adminUserId: admin.id, reviewNote: String(request.body?.note ?? "") }));
  });

  app.post<{ Params: { id: string }; Body: { note: string } }>("/api/admin/credit-requests/:id/reject", async (request, reply) => {
    const admin = await requireAdmin(request, dependencies.authService);
    return reply.send(await dependencies.adminRepository.rejectTopup({ requestId: request.params.id, adminUserId: admin.id, reviewNote: request.body?.note ?? "" }));
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/admin/audit-logs", async (request, reply) => {
    await requireAdmin(request, dependencies.authService);
    return reply.send({ items: await dependencies.adminRepository.listAudit({ limit: pageSize(request.query.limit), offset: offset(request.query.offset) }) });
  });
}

function publicUser(user: { id: string; email: string; emailVerifiedAt: Date | null; role: string; status: string; mustChangePassword: boolean }) {
  return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null, role: user.role, status: user.status, mustChangePassword: user.mustChangePassword };
}

function pageSize(value?: string): number {
  const parsed = Number(value ?? 50);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
}

function offset(value?: string): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
