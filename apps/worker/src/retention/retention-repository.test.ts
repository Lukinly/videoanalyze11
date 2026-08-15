import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createRetentionRepository } from "./retention-repository.js";

const now = new Date("2026-08-15T12:00:00.000Z");

describe("retention repository claims", () => {
  it("claims expired abandoned uploads with row locks that skip concurrent sweep claims", async () => {
    const client = scriptedClient([result(), result([{ id: "object_1", key: "orphan.mp4", kind: "original", videoId: "video_1", claimToken: "token_1" }]), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await expect(repository.claimExpiredTransientObjects(now)).resolves.toEqual([{ id: "object_1", key: "orphan.mp4", kind: "original", videoId: "video_1", claimToken: "token_1" }]);
    const claim = queryText(client, 1);
    expect(claim).toContain("UPDATE transient_objects");
    expect(claim).toContain("cleanup_status = 'cleaning'");
    expect(claim).toContain("cleanup_lease_expires_at <= $1");
    expect(claim).toContain("cleanup_claim_token");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("deleted_at IS NULL");
    expect(claim).toContain("expires_at <= $1");
    expect(claim).toContain("run_id IS NULL");
    expect(claim).toContain("linked.video_id = transient.video_id");
    expect(queryParams(client, 1)).toEqual([now, new Date("2026-08-15T12:05:00.000Z"), expect.any(String)]);
  });

  it("fences transient completion and retry metadata with the durable claim token", async () => {
    const client = scriptedClient([result(), result([], 0), result()]);
    const repository = createRetentionRepository(poolWith(client));

    await repository.markTransientObjectDeleted({ objectId: "object_1", videoId: "video_1", claimToken: "old_token", now });

    expect(queryText(client, 1)).toContain("cleanup_claim_token = $3");
    expect(queryText(client, 1)).toContain("cleanup_status = 'cleaning'");
    expect(vi.mocked(client.query)).toHaveBeenCalledTimes(3);
  });

  it("claims terminal cleanup retries without selecting active runs", async () => {
    const client = scriptedClient([result(), result([{ runId: "run_terminal" }]), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await expect(repository.claimTerminalCleanupRuns(now)).resolves.toEqual(["run_terminal"]);
    const claim = queryText(client, 1);
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("status IN ('completed', 'failed', 'cancelled')");
    expect(claim).toContain("media_cleanup_status IN ('pending', 'failed')");
    expect(queryParams(client, 1)).toEqual([new Date("2026-08-15T11:55:00.000Z")]);
  });

  it("fails only runs older than four hours whose heartbeat is at least fifteen minutes old", async () => {
    const client = scriptedClient([result(), result([{ runId: "run_stale" }]), result()]);
    const repository = createRetentionRepository(poolWith(client));
    const input = { now, runCreatedBefore: new Date("2026-08-15T08:00:00.000Z"), heartbeatBefore: new Date("2026-08-15T11:45:00.000Z"), error: "analysis run failed after missing its heartbeat" };
    await expect(repository.failStaleRuns(input)).resolves.toEqual(["run_stale"]);
    const claim = queryText(client, 1);
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("created_at < $2");
    expect(claim).toContain("COALESCE(heartbeat_at, created_at) < $3");
    expect(claim).toContain("status IN ('queued', 'running', 'cancelling')");
    expect(queryParams(client, 1)).toEqual([now, input.runCreatedBefore, input.heartbeatBefore, input.error]);
  });

  it("claims held stale-timeout reservations by a stable failure kind after error text changes", async () => {
    const client = scriptedClient([result(), result([{ runId: "run_stale" }]), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await expect(repository.claimStaleFailureReservations(now)).resolves.toEqual(["run_stale"]);
    const sql = queryText(client, 1);
    expect(sql).toContain("credit_reservations reservation");
    expect(sql).toContain("reservation.status = 'held'");
    expect(sql).toContain("run.failure_kind = 'stale_timeout'");
    expect(sql).not.toContain("run.error");
    expect(sql).toContain("FOR UPDATE OF reservation SKIP LOCKED");
  });

  it("protects a stale-created run with a fresh heartbeat", async () => {
    const client = scriptedClient([result(), result([]), result()]);
    const repository = createRetentionRepository(poolWith(client));
    const runIds = await repository.failStaleRuns({ now, runCreatedBefore: new Date("2026-08-15T08:00:00.000Z"), heartbeatBefore: new Date("2026-08-15T11:45:00.000Z"), error: "analysis run failed after missing its heartbeat" });
    expect(runIds).toEqual([]);
  });
});

describe("privacy expiry deletion", () => {
  it("deletes all ephemeral bodies, clears chunk payloads, and marks the run in one transaction", async () => {
    const client = scriptedClient([result(), result([{ runId: "privacy_run" }]), result([], 2), result([], 1), result([], 3), result([], 1), result([], 4), result([], 1), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await expect(repository.deleteExpiredPrivacyResults(now)).resolves.toBe(1);
    const statements = vi.mocked(client.query).mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("retention_mode = 'privacy'");
    expect(statements[1]).toContain("results_deleted_at IS NULL");
    expect(statements[1]).toContain("result_expires_at <= $1");
    expect(statements[1]).toContain("FOR UPDATE SKIP LOCKED");
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining("DELETE FROM ephemeral_transcript_segments"),
      expect.stringContaining("DELETE FROM ephemeral_run_summaries"),
      expect.stringContaining("DELETE FROM ephemeral_chapters"),
      expect.stringContaining("DELETE FROM ephemeral_ai_notes"),
      expect.stringContaining("UPDATE chunks"),
      expect.stringContaining("results_deleted_at = $2")
    ]));
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("never selects from or deletes ordinary result tables during privacy expiry", async () => {
    const client = scriptedClient([result(), result([{ runId: "privacy_run" }]), result(), result(), result(), result(), result(), result(), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await repository.deleteExpiredPrivacyResults(now);
    const sql = vi.mocked(client.query).mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).not.toMatch(/(?:FROM|UPDATE|INTO) transcript_segments\b/);
    expect(sql).not.toMatch(/(?:FROM|UPDATE|INTO) chapters\b/);
    expect(sql).not.toContain("summary_json");
  });

  it("rolls back the whole privacy deletion when any body deletion fails", async () => {
    const client = scriptedClient([result(), result([{ runId: "privacy_run" }]), result(), new Error("chapter deletion failed"), result()]);
    const repository = createRetentionRepository(poolWith(client));
    await expect(repository.deleteExpiredPrivacyResults(now)).rejects.toThrow("chapter deletion failed");
    const statements = vi.mocked(client.query).mock.calls.map(([sql]) => String(sql));
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});

function poolWith(client: PoolClient): Pool { return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool; }
function scriptedClient(script: Array<QueryResult<Record<string, unknown>> | Error>): PoolClient {
  const responses = [...script];
  return { query: vi.fn().mockImplementation(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected query");
    return response;
  }), release: vi.fn() } as unknown as PoolClient;
}
function result<T extends Record<string, unknown>>(rows: T[] = [], rowCount = rows.length): QueryResult<T> { return { rows, rowCount, command: "", oid: 0, fields: [] }; }
function queryText(client: PoolClient, index: number): string { return String(vi.mocked(client.query).mock.calls[index]?.[0]); }
function queryParams(client: PoolClient, index: number): unknown[] | undefined { return vi.mocked(client.query).mock.calls[index]?.[1] as unknown[] | undefined; }
