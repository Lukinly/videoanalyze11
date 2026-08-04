import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { createRepositories } from "./repositories/index.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("analysis run repository", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("./test-database.js");
    const { createRepositories } = await import("./repositories/index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM analysis_runs");
    await pool.query("DELETE FROM videos");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns a run only to its owner and updates cancellation state", async () => {
    const user = await repositories.users.create({ email: "owner@example.com", passwordHash: "hash" });
    const other = await repositories.users.create({ email: "other@example.com", passwordHash: "hash" });
    const video = await repositories.videos.create({ userId: user.id, objectKey: "users/u/video", fileName: "video.mp4" });
    const run = await repositories.runs.create({ id: "run_1", userId: user.id, videoId: video.id });

    expect(await repositories.runs.findOwnedById(other.id, run.id)).toBeNull();
    expect(await repositories.runs.requestCancellation(user.id, run.id)).toMatchObject({ status: "cancelling" });
  });
});
