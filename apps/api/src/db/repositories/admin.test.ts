import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM admin_audit_logs");
    await pool.query("DELETE FROM credit_topup_requests");
    await pool.query("DELETE FROM credit_ledger");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a verified ordinary account with welcome credits and a password-free audit, then supports first-login password change", async () => {
    const { hashPassword } = await import("../../auth/passwords.js");
    const { createAuthService } = await import("../../auth/auth-service.js");
    const admin = await repositories.users.create({ email: "creator@example.com", passwordHash: "hash", role: "admin", emailVerifiedAt: new Date() });
    const user = await repositories.admin.createUser({ email: "manual@example.com", passwordHash: await hashPassword("initial password"), adminUserId: admin.id, reason: "support request" });
    expect(user).toMatchObject({ role: "user", status: "active", mustChangePassword: true });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 12 });
    const audits = await repositories.admin.listAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ adminUserId: admin.id, action: "create_user", targetUserId: user.id, metadata: { email: user.email }, reason: "support request" });
    expect(JSON.stringify(audits)).not.toContain("password");

    const auth = createAuthService({ repositories, mailer: { sendVerification: vi.fn(), sendRegistrationCode: vi.fn(), sendPasswordReset: vi.fn() }, verificationBaseUrl: "https://app.example.com" });
    const login = await auth.login({ email: user.email, password: "initial password" });
    expect(login.user).toMatchObject({ role: "user", mustChangePassword: true });
    await auth.changePassword({ userId: user.id, password: "new secure password", confirmPassword: "new secure password" });
    await expect(auth.authenticate(login.sessionToken)).resolves.toMatchObject({ mustChangePassword: false });
    await expect(auth.login({ email: user.email, password: "initial password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: user.email, password: "new secure password" })).resolves.toMatchObject({ user: { role: "user", mustChangePassword: false } });
  });

  it("rejects a duplicate email without overwriting an account or adding more credits or audit entries", async () => {
    const admin = await repositories.users.create({ email: "creator@example.com", passwordHash: "hash", role: "admin" });
    const input = { email: "duplicate@example.com", passwordHash: "original-hash", adminUserId: admin.id, reason: "support request" };
    const created = await repositories.admin.createUser(input);
    await expect(repositories.admin.createUser({ ...input, passwordHash: "replacement-hash" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED", status: 409 });
    await expect(repositories.users.findById(created.id)).resolves.toMatchObject({ passwordHash: "original-hash" });
    await expect(repositories.credits.getBalance(created.id)).resolves.toMatchObject({ available: 12 });
    await expect(repositories.admin.listAudit()).resolves.toHaveLength(1);
  });

  it("rolls back account and credit creation when the audit write fails", async () => {
    const { createAdminRepository } = await import("./admin.js");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO users")) return { rows: [{ id: "new-user", email: "new@example.com" }], rowCount: 1 };
      if (sql.includes("INSERT INTO admin_audit_logs")) throw new Error("audit unavailable");
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const failingPool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as import("pg").Pool;
    await expect(createAdminRepository(failingPool).createUser({ email: "new@example.com", passwordHash: "hash", adminUserId: "admin", reason: "support request" })).rejects.toThrow("audit unavailable");
    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
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
