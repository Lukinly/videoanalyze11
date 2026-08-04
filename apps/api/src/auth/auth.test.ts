import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("authentication service", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;
  let mailer: { sendVerification: ReturnType<typeof vi.fn> };
  let auth: ReturnType<typeof createAuthService>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../db/test-database.js");
    const { createRepositories } = await import("../db/repositories/index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM email_verifications");
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM usage_ledger");
    await pool.query("DELETE FROM users");
    mailer = { sendVerification: vi.fn() };
    auth = createAuthService({ repositories, mailer, verificationBaseUrl: "http://localhost:5173" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("grants exactly two credits on first successful email verification", async () => {
    const registered = await auth.register({ email: "user@example.com", password: "correct horse battery staple" });
    const token = mailer.sendVerification.mock.calls[0][0].token as string;

    const first = await auth.verifyEmail(token);
    const second = await auth.verifyEmail(token);

    expect(first.trialCreditsGranted).toBe(true);
    expect(second.trialCreditsGranted).toBe(false);
    expect(await repositories.usage.getAvailableCredits(registered.userId)).toBe(2);
  });

  it("rejects login before email verification", async () => {
    await auth.register({ email: "pending@example.com", password: "correct horse battery staple" });

    await expect(auth.login({ email: "pending@example.com", password: "correct horse battery staple" }))
      .rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });
});

async function loadAuthModules() {
  const [{ createRepositories }, { createAuthService }] = await Promise.all([
    import("../db/repositories/index.js"),
    import("./auth-service.js")
  ]);
  return { createRepositories, createAuthService };
}

const { createRepositories, createAuthService } = await loadAuthModules();
