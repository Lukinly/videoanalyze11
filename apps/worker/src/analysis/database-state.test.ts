import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createDatabaseState } from "./database-state.js";
import type { createMediaProcessor } from "../media/media-processor.js";
import type { createWorkerCreditRepository } from "../credits/credit-repository.js";
import type { ResultStore } from "../results/result-store.js";

describe("worker database state", () => {
  it("builds 120-second Qwen chunks so PCM Base64 stays below the provider limit", async () => {
    const chunks: Array<{ index: number; start: number; end: number; status: string; transcriptJson: null }> = [];
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      if (sql.includes("FROM chunks")) return { rows: chunks.slice() };
      if (sql.includes("FROM analysis_runs")) return { rows: [{ userId: "u" }] };
      if (sql.includes("INSERT INTO chunks")) { chunks.push({ index: values[3] as number, start: values[4] as number, end: values[5] as number, status: "pending", transcriptJson: null }); return { rows: [] }; }
      throw new Error("unexpected query");
    });
    const state = createDatabaseState({ pool: { query } as unknown as Pool, s3: {} as S3Client, bucket: "test", directory: "/tmp/qwen-chunks", media: {} as ReturnType<typeof createMediaProcessor>, results: {} as ResultStore, credits: {} as ReturnType<typeof createWorkerCreditRepository>, clock: { now: () => new Date() }, chunking: { targetSeconds: 120, maxBytes: 6_000_000 } });
    state.setRemoteInput("/tmp/source.m4a", 300);
    const result = await state.getChunks("run");
    expect(result.map(({ start, end }) => [start, end])).toEqual([[0, 120], [112, 232], [224, 300]]);
    expect(result.every(({ start, end }) => Math.ceil(((end - start) * 32000 + 128) / 3) * 4 < 10_000_000)).toBe(true);
  });
  it.each([null, 7])("probes a new upload before billing, ignoring stored duration %s", async (storedDuration) => {
    const directory = await mkdtemp(join(tmpdir(), "video-state-"));
    try {
      await writeFile(join(directory, "original"), "test video");
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ duration: storedDuration, platform: "upload" }] })
        .mockResolvedValueOnce({ rows: [{ duration: storedDuration, platform: "upload", objectKey: "original" }] })
        .mockResolvedValueOnce({ rows: [] });
      const probe = vi.fn().mockResolvedValue({ duration: 61 });
      const state = createDatabaseState({
        pool: { query } as unknown as Pool, s3: {} as S3Client, bucket: "test", directory,
        media: { probe } as unknown as ReturnType<typeof createMediaProcessor>,
        results: {} as ResultStore, credits: {} as ReturnType<typeof createWorkerCreditRepository>, clock: { now: () => new Date() }
      });
      expect(await state.getSourceInfo("run")).toEqual({ duration: 61, remote: null });
      expect(await state.getRun("run")).toMatchObject({ duration: 61 });
      expect(probe).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE videos SET duration"), ["original", 61, expect.any(Date)]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects an over-limit upload before billing or audio extraction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-state-"));
    try {
      await writeFile(join(directory, "original"), "test video");
      const query = vi.fn().mockResolvedValue({ rows: [{ duration: null, platform: "upload", objectKey: "original" }] });
      const state = createDatabaseState({
        pool: { query } as unknown as Pool, s3: {} as S3Client, bucket: "test", directory,
        media: { probe: vi.fn().mockResolvedValue({ duration: 14_401 }) } as unknown as ReturnType<typeof createMediaProcessor>,
        results: {} as ResultStore, credits: {} as ReturnType<typeof createWorkerCreditRepository>, clock: { now: () => new Date() }
      });
      await expect(state.getSourceInfo("run")).rejects.toThrow("four-hour limit");
      expect(query).toHaveBeenCalledTimes(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
