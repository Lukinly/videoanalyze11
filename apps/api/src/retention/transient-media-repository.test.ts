import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("transient media repository", () => {
  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../db/test-database.js");
    await migrateTestDatabase(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM transient_objects");
    await pool.query("DELETE FROM videos");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("counts a tracked original's live bytes", async () => {
    const { createTransientMediaRepository } = await import("./transient-media-repository.js");
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
      ["u1", "u1@example.com", "hash", new Date()]
    );
    const repository = createTransientMediaRepository(pool);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await repository.createTrackedOriginal({ userId: "u1", videoId: "v1", objectKey: "k1", fileName: "clip.mp4", sizeBytes: 20, expiresAt });

    expect(await repository.getLiveBytes()).toBe(20);
  });
});
