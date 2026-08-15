import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { createRepositories } from "./index.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("administrator repository", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../test-database.js");
    const { createRepositories } = await import("./index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_audit_logs");
    await pool.query("DELETE FROM credit_topup_requests");
    await pool.query("DELETE FROM credit_ledger");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lists a top-up with its applicant email", async () => {
    const user = await repositories.users.create({ email: "applicant@example.com", passwordHash: "hash" });
    await repositories.admin.createTopup({ userId: user.id, requestedAmount: 30, note: "bank transfer" });

    await expect(repositories.admin.listTopups({ status: "pending" })).resolves.toMatchObject([
      {
        userId: user.id,
        userEmail: "applicant@example.com",
        requestedAmount: 30
      }
    ]);
  });

  it("approves a top-up idempotently with one grant and one audit entry", async () => {
    const user = await repositories.users.create({ email: "topup-user@example.com", passwordHash: "hash" });
    const admin = await repositories.users.create({ email: "topup-admin@example.com", passwordHash: "hash", role: "admin", emailVerifiedAt: new Date() });
    const request = await repositories.admin.createTopup({ userId: user.id, requestedAmount: 50, note: "bank transfer" });

    await repositories.admin.approveTopup({ requestId: request.id, adminUserId: admin.id, reviewNote: "received" });
    await repositories.admin.approveTopup({ requestId: request.id, adminUserId: admin.id, reviewNote: "received again" });

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 50 });
    await expect(repositories.admin.listAudit()).resolves.toHaveLength(1);
  });

  it("rejects a top-up without creating a grant", async () => {
    const user = await repositories.users.create({ email: "reject-user@example.com", passwordHash: "hash" });
    const admin = await repositories.users.create({ email: "reject-admin@example.com", passwordHash: "hash", role: "admin", emailVerifiedAt: new Date() });
    const request = await repositories.admin.createTopup({ userId: user.id, requestedAmount: 50, note: "unknown" });

    await repositories.admin.rejectTopup({ requestId: request.id, adminUserId: admin.id, reviewNote: "not received" });

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 0 });
    await expect(repositories.admin.listAudit()).resolves.toHaveLength(1);
  });

  it("protects the last active administrator from role and status removal", async () => {
    const admin = await repositories.users.create({ email: "last-admin@example.com", passwordHash: "hash", role: "admin", emailVerifiedAt: new Date() });

    await expect(repositories.users.setRole(admin.id, "user")).rejects.toMatchObject({ code: "LAST_ADMIN_PROTECTED" });
    await expect(repositories.users.setStatus(admin.id, "suspended")).rejects.toMatchObject({ code: "LAST_ADMIN_PROTECTED" });
  });

  it("does not duplicate an admin adjustment or its audit event on retry", async () => {
    const user = await repositories.users.create({ email: "adjust-user@example.com", passwordHash: "hash" });
    const admin = await repositories.users.create({ email: "adjust-admin@example.com", passwordHash: "hash", role: "admin", emailVerifiedAt: new Date() });
    const input = { targetUserId: user.id, adminUserId: admin.id, amount: 8, type: "admin_grant" as const, reason: "support credit", idempotencyKey: "adjustment-1" };

    await repositories.admin.adjustCredits(input);
    await repositories.admin.adjustCredits(input);

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 8 });
    await expect(repositories.admin.listAudit()).resolves.toHaveLength(1);
  });
});
