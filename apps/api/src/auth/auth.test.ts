import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { createRepositories } from "../db/repositories/index.js";
import { hashPassword } from "./passwords.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("authentication service", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;
  let mailer: { sendVerification: ReturnType<typeof vi.fn>; sendRegistrationCode: ReturnType<typeof vi.fn>; sendPasswordReset: ReturnType<typeof vi.fn> };
  let auth: ReturnType<typeof createAuthService>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../db/test-database.js");
    const { createRepositories } = await import("../db/repositories/index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM password_reset_tokens");
    await pool.query("DELETE FROM email_verifications");
    await pool.query("DELETE FROM registration_verifications");
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM usage_ledger");
    await pool.query("DELETE FROM users");
    mailer = { sendVerification: vi.fn(), sendRegistrationCode: vi.fn(), sendPasswordReset: vi.fn() };
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects mismatched registration passwords before creating a user", async () => {
    await expect(auth.register({
      email: "user@example.com",
      password: "correct horse battery staple",
      confirmPassword: "different password",
      verificationCode: "123456"
    })).rejects.toMatchObject({ code: "PASSWORD_MISMATCH", status: 400 });
    expect(await repositories.users.findByEmail("user@example.com")).toBeNull();
  });

  it("sends a six-digit code and creates an already-verified user", async () => {
    const requested = await auth.sendRegistrationCode({ email: "user@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;

    expect(requested).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(code).toMatch(/^\d{6}$/);

    const registered = await auth.register({
      email: "user@example.com",
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: code
    });
    const user = await repositories.users.findById(registered.userId);
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(await repositories.credits.getBalance(registered.userId)).toMatchObject({ available: 12 });
    await expect(auth.login({ email: "user@example.com", password: "correct horse battery staple" }))
      .resolves.toMatchObject({ user: { id: registered.userId } });
  });

  it("invalidates a failed delivery while preserving the resend cooldown", async () => {
    mailer.sendRegistrationCode.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(auth.sendRegistrationCode({ email: "failed@example.com" })).rejects.toThrow("SMTP unavailable");
    const failed = await repositories.auth.findRegistrationCode("failed@example.com");
    expect(failed!.expiresAt.getTime()).toBe(failed!.createdAt.getTime());
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;
    await expect(auth.register({ email: "failed@example.com", password: "safe password", confirmPassword: "safe password", verificationCode: code })).rejects.toMatchObject({ code: "INVALID_REGISTRATION_CODE" });
    await expect(auth.sendRegistrationCode({ email: "failed@example.com" })).rejects.toMatchObject({ code: "REGISTRATION_CODE_RATE_LIMITED" });
  });

  it("rejects a wrong code without creating a user", async () => {
    await auth.sendRegistrationCode({ email: "wrong@example.com" });

    await expect(auth.register({
      email: "wrong@example.com",
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: "000000"
    })).rejects.toMatchObject({ code: "INVALID_REGISTRATION_CODE" });
    expect(await repositories.users.findByEmail("wrong@example.com")).toBeNull();
  });

  it("allows registration to retry when the welcome-credit grant temporarily fails", async () => {
    await auth.sendRegistrationCode({ email: "retry@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;
    const grant = vi.fn().mockRejectedValueOnce(new Error("credits unavailable")).mockResolvedValue(true);
    auth = createAuthService({ repositories: { ...repositories, credits: { grant } }, mailer, verificationBaseUrl: "http://localhost:5173" });

    await expect(auth.register({ email: "retry@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: code })).rejects.toThrow("credits unavailable");
    await expect(auth.register({ email: "retry@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: code })).resolves.toMatchObject({ verified: true });
    expect(grant).toHaveBeenCalledTimes(2);
  });

  it("exhausts a code after five invalid attempts", async () => {
    await auth.sendRegistrationCode({ email: "exhausted@example.com" });
    const input = {
      email: "exhausted@example.com",
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: "000000"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(auth.register(input)).rejects.toMatchObject({ code: "INVALID_REGISTRATION_CODE" });
    }
    await expect(auth.register(input)).rejects.toMatchObject({ code: "REGISTRATION_CODE_EXHAUSTED" });
  });

  it("rejects an expired registration code", async () => {
    const clock = new Date("2026-08-04T00:00:00Z");
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173", now: () => clock });
    await auth.sendRegistrationCode({ email: "expired@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;
    clock.setTime(clock.getTime() + 10 * 60_000);

    await expect(auth.register({
      email: "expired@example.com",
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: code
    })).rejects.toMatchObject({ code: "INVALID_REGISTRATION_CODE" });
  });

  it("rejects a second send within sixty seconds and allows a legacy unverified user to verify", async () => {
    const clock = new Date("2026-08-04T00:00:00Z");
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173", now: () => clock });
    await auth.sendRegistrationCode({ email: "legacy@example.com" });
    await expect(auth.sendRegistrationCode({ email: "legacy@example.com" }))
      .rejects.toMatchObject({ code: "REGISTRATION_CODE_RATE_LIMITED", status: 429 });
    clock.setTime(clock.getTime() + 60_000);
    await auth.sendRegistrationCode({ email: "legacy@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls.at(-1)![0].code as string;
    const legacy = await repositories.users.create({ email: "legacy@example.com", passwordHash: await hashPassword("correct horse battery staple") });

    expect(legacy.emailVerifiedAt).toBeNull();
    await expect(auth.register({
      email: legacy.email,
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: code
    })).resolves.toMatchObject({ userId: legacy.id, verified: true });
  });

  it("rejects login before email verification", async () => {
    await repositories.users.create({ email: "pending@example.com", passwordHash: await hashPassword("correct horse battery staple") });

    await expect(auth.login({ email: "pending@example.com", password: "correct horse battery staple" }))
      .rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("rejects suspended users when an existing session is authenticated", async () => {
    await auth.sendRegistrationCode({ email: "suspended@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;
    const registered = await auth.register({ email: "suspended@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: code });
    const login = await auth.login({ email: "suspended@example.com", password: "correct horse battery staple" });
    await repositories.users.setStatus(registered.userId, "suspended");

    await expect(auth.authenticate(login.sessionToken)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", status: 403 });
  });

  it("allows a password reset token to be used only once", async () => {
    await auth.sendRegistrationCode({ email: "reset@example.com" });
    const code = mailer.sendRegistrationCode.mock.calls[0][0].code as string;
    const registered = await auth.register({ email: "reset@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: code });

    const reset = await auth.requestPasswordReset(registered.userId);
    await expect(auth.resetPassword({ token: reset.token, password: "new secure password", confirmPassword: "new secure password" })).resolves.toEqual({ ok: true });
    await expect(auth.resetPassword({ token: reset.token, password: "another password", confirmPassword: "another password" })).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    await expect(auth.login({ email: "reset@example.com", password: "new secure password" })).resolves.toMatchObject({ user: { id: registered.userId } });
  });

  it("sends a normalized email a reset link, throttles repeat sends, and revokes old sessions and tokens after reset", async () => {
    const clock = new Date("2026-10-25T00:00:00Z");
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173", now: () => clock });
    const user = await repositories.users.create({ email: "recovery@example.com", passwordHash: await hashPassword("original password"), emailVerifiedAt: clock });
    const session = await auth.login({ email: user.email, password: "original password" });
    await expect(auth.forgotPassword({ email: " Recovery@Example.com " })).resolves.toEqual({ ok: true });
    const first = mailer.sendPasswordReset.mock.calls[0][0];
    expect(first.link).toBe(`http://localhost:5173/reset-password?token=${first.token}`);
    await expect(auth.forgotPassword({ email: user.email })).resolves.toEqual({ ok: true });
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
    clock.setTime(clock.getTime() + 60_000);
    await auth.forgotPassword({ email: user.email });
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(2);
    const second = mailer.sendPasswordReset.mock.calls[1][0];
    await expect(auth.resetPassword({ token: second.token, password: "new secure password", confirmPassword: "different password" })).rejects.toMatchObject({ code: "PASSWORD_MISMATCH" });
    await auth.resetPassword({ token: second.token, password: "new secure password", confirmPassword: "new secure password" });
    await expect(auth.authenticate(session.sessionToken)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(auth.login({ email: user.email, password: "original password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: user.email, password: "new secure password" })).resolves.toMatchObject({ user: { id: user.id } });
    await expect(auth.resetPassword({ token: first.token, password: "another password", confirmPassword: "another password" })).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
  });

  it("returns the same acknowledgement without emailing unknown, unverified, or suspended accounts", async () => {
    await repositories.users.create({ email: "unverified@example.com", passwordHash: "hash" });
    const user = await repositories.users.create({ email: "disabled@example.com", passwordHash: "hash", emailVerifiedAt: new Date() });
    await repositories.users.setStatus(user.id, "suspended");
    for (const email of ["unknown@example.com", "unverified@example.com", "disabled@example.com"]) {
      await expect(auth.forgotPassword({ email })).resolves.toEqual({ ok: true });
    }
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
    await expect(auth.forgotPassword({ email: "invalid" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rejects expired and unknown reset links without changing the password", async () => {
    const clock = new Date("2026-10-25T00:00:00Z");
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173", now: () => clock });
    const user = await repositories.users.create({ email: "expired-reset@example.com", passwordHash: await hashPassword("original password"), emailVerifiedAt: clock });
    await auth.forgotPassword({ email: user.email });
    clock.setTime(clock.getTime() + 60 * 60_000);
    for (const token of [mailer.sendPasswordReset.mock.calls[0][0].token, "unknown-token"]) {
      await expect(auth.resetPassword({ token, password: "new secure password", confirmPassword: "new secure password" })).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    }
    await expect(auth.login({ email: user.email, password: "original password" })).resolves.toMatchObject({ user: { id: user.id } });
  });
});

async function loadAuthModules() {
  const { createAuthService } = await import("./auth-service.js");
  return { createAuthService };
}

const { createAuthService } = await loadAuthModules();
