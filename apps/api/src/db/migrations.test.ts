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

  it("adds durable transient cleanup leases", async () => {
    const sql = await readFile(join(migrations, "0006_retention_cleanup_leases.sql"), "utf8");
    expect(sql).toContain("cleanup_status");
    expect(sql).toContain("cleanup_lease_expires_at");
    expect(sql).toContain("cleanup_claim_token");
  });

  it("adds a durable analysis failure classification", async () => {
    const sql = await readFile(join(migrations, "0007_analysis_failure_kind.sql"), "utf8");
    expect(sql).toContain("failure_kind");
    expect(sql).toContain("stale_timeout");
  });

  it("adds immutable duration billing snapshots and isolated AI note bodies", async () => {
    const sql = await readFile(join(migrations, "0008_duration_billing_ai_notes.sql"), "utf8");

    expect(sql).toContain("billing_rule_version");
    expect(sql).toContain("billed_duration_seconds");
    expect(sql).toContain("billed_minutes");
    expect(sql).toContain("reserved_credits");
    expect(sql).toContain("CREATE TRIGGER analysis_runs_billing_snapshot_immutable");
    expect(sql).toContain("CREATE TABLE ai_notes");
    expect(sql).toContain("CREATE TABLE ephemeral_ai_notes");
  });

  it("stores normalized external video source metadata", async () => {
    const sql = await readFile(join(migrations, "0009_link_video_sources.sql"), "utf8");
    expect(sql).toContain("source_platform");
    expect(sql).toContain("source_url");
    expect(sql).toContain("external_video_id");
    expect(sql).toContain("source_part");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS videos_external_source_idx");
    expect(sql).not.toContain("analysis_runs_one_active_per_video_idx");
  });
});
