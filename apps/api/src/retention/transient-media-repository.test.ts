import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { PoolClient } from "pg";

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
    const repository = createTransientMediaRepository(pool, { capacityGate: createTestCapacityGate() });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await repository.createTrackedOriginal({ userId: "u1", videoId: "v1", objectKey: "k1", fileName: "clip.mp4", sizeBytes: 20, expiresAt });

    expect(await repository.getLiveBytes()).toBe(20);
  });

  it("counts expired media until cleanup marks it deleted", async () => {
    const { createTransientMediaRepository } = await import("./transient-media-repository.js");
    await createUser("u1");
    const repository = createTransientMediaRepository(pool, { capacityGate: createTestCapacityGate() });

    await repository.createTrackedOriginal({
      userId: "u1",
      videoId: "v1",
      objectKey: "expired",
      fileName: "clip.mp4",
      sizeBytes: 20,
      expiresAt: new Date("2020-01-01T00:00:00.000Z")
    });

    expect(await repository.getLiveBytes()).toBe(20);

    await pool.query("UPDATE transient_objects SET deleted_at = $1 WHERE object_key = $2", [new Date(), "expired"]);
    expect(await repository.getLiveBytes()).toBe(0);
  });

  it("serializes concurrent admissions so only one upload can reach the 80 percent threshold", async () => {
    const { createTransientMediaRepository } = await import("./transient-media-repository.js");
    await createUser("u1");
    const repository = createTransientMediaRepository(pool, {
      capacityBytes: 40,
      capacityGate: createTestCapacityGate()
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await repository.createTrackedOriginal({ userId: "u1", videoId: "v1", objectKey: "k1", fileName: "clip.mp4", sizeBytes: 31, expiresAt });
    const results = await Promise.allSettled([
      repository.createTrackedOriginal({ userId: "u1", videoId: "v2", objectKey: "k2", fileName: "clip.mp4", sizeBytes: 1, expiresAt }),
      repository.createTrackedOriginal({ userId: "u1", videoId: "v3", objectKey: "k3", fileName: "clip.mp4", sizeBytes: 1, expiresAt })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]?.reason).toMatchObject({ code: "TEMP_STORAGE_FULL", status: 503 });
    expect(await repository.getLiveBytes()).toBe(32);
  });
});

async function createUser(id: string) {
  await pool.query(
    "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
    [id, `${id}@example.com`, "hash", new Date()]
  );
}

function createTestCapacityGate() {
  let tail = Promise.resolve();
  return {
    async acquire(client: PoolClient): Promise<() => void> {
      void client;
      const previous = tail;
      let release: () => void = () => {};
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      return release;
    }
  };
}
