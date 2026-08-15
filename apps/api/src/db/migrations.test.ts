import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("database migrations", () => {
  it("defines the transient retention tables", async () => {
    const sql = await readFile(join(migrations, "0005_transient_retention.sql"), "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS transient_objects");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_transcript_segments");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_run_summaries");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_chapters");
  });
});
