import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { createRepositories } from "./index.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("credit repository", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../test-database.js");
    const { createRepositories } = await import("./index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM credit_reservations");
    await pool.query("DELETE FROM credit_ledger");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("adds a grant to the available balance exactly once", async () => {
    const user = await repositories.users.create({ email: "credit@example.com", passwordHash: "hash" });

    await repositories.credits.grant({
      userId: user.id,
      amount: 12,
      type: "welcome_grant",
      idempotencyKey: `welcome:${user.id}`,
      reason: "email_verified"
    });
    await repositories.credits.grant({
      userId: user.id,
      amount: 12,
      type: "welcome_grant",
      idempotencyKey: `welcome:${user.id}`,
      reason: "email_verified"
    });

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ ledgerBalance: 12, held: 0, available: 12 });
  });

  it("does not allow two reservations to spend the same balance", async () => {
    const user = await repositories.users.create({ email: "concurrent@example.com", passwordHash: "hash" });
    await repositories.credits.grant({
      userId: user.id,
      amount: 12,
      type: "welcome_grant",
      idempotencyKey: `welcome:${user.id}`,
      reason: "email_verified"
    });

    // PostgreSQL serializes these transactions through the user's row lock.
    // pg-mem does not emulate concurrent row-lock waits, so issue the second
    // request after the first transaction has committed.
    const result = [
      await repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_a", amount: 10 }),
      await repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_b", amount: 10 })
    ];

    expect(result.sort()).toEqual(["exhausted", "held"]);
    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ available: 2, held: 10 });
  });

  it("releases a failed reservation without creating a debit", async () => {
    const user = await repositories.users.create({ email: "release@example.com", passwordHash: "hash" });
    await repositories.credits.grant({
      userId: user.id,
      amount: 12,
      type: "welcome_grant",
      idempotencyKey: `welcome:${user.id}`,
      reason: "email_verified"
    });
    await repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_a", amount: 2 });

    await repositories.credits.releaseReservation("run_a", "provider_failed");

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ ledgerBalance: 12, held: 0, available: 12 });
    await expect(repositories.credits.listLedger(user.id, 10)).resolves.toHaveLength(1);
  });

  it("consumes a reservation and charges it only once", async () => {
    const user = await repositories.users.create({ email: "consume@example.com", passwordHash: "hash" });
    await repositories.credits.grant({
      userId: user.id,
      amount: 12,
      type: "welcome_grant",
      idempotencyKey: `welcome:${user.id}`,
      reason: "email_verified"
    });
    await repositories.credits.reserveAnalysis({ userId: user.id, runId: "run_a", amount: 2 });

    await repositories.credits.consumeReservation("run_a");
    await repositories.credits.consumeReservation("run_a");

    await expect(repositories.credits.getBalance(user.id)).resolves.toMatchObject({ ledgerBalance: 10, held: 0, available: 10 });
    await expect(repositories.credits.listLedger(user.id, 10)).resolves.toHaveLength(2);
  });
});
