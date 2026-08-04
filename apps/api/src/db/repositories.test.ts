import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("tenant-safe repositories", () => {
  beforeAll(async () => {
    const { migrateTestDatabase } = await import("./test-database.js");
    await migrateTestDatabase(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM usage_ledger");
    await pool.query("DELETE FROM videos");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("does not return another user's video", async () => {
    const { createRepositories } = await import("./repositories/index.js");
    const repositories = createRepositories(pool);
    const userA = await repositories.users.create({ email: "a@example.com", passwordHash: "hash-a" });
    const userB = await repositories.users.create({ email: "b@example.com", passwordHash: "hash-b" });
    const video = await repositories.videos.create({ userId: userA.id, objectKey: "users/a/video", fileName: "a.mp4" });

    expect(await repositories.videos.findOwnedById(userB.id, video.id)).toBeNull();
    expect(await repositories.videos.findOwnedById(userA.id, video.id)).toMatchObject({ id: video.id });
  });

  it("reserves one credit only once for the same analysis run", async () => {
    const { createRepositories } = await import("./repositories/index.js");
    const repositories = createRepositories(pool);
    const user = await repositories.users.create({ email: "quota@example.com", passwordHash: "hash" });
    await repositories.usage.grantCredits(user.id, 2, "email_verified");

    const first = await repositories.usage.reserveAnalysis({ userId: user.id, runId: "run_a", idempotencyKey: "run_a" });
    const second = await repositories.usage.reserveAnalysis({ userId: user.id, runId: "run_a", idempotencyKey: "run_a" });

    expect([first, second].sort()).toEqual(["already_reserved", "reserved"]);
    expect(await repositories.usage.getAvailableCredits(user.id)).toBe(1);
  });
});
