import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../../apps/api/src/db/migrate.js";
import { createVideoRepository } from "../../apps/api/src/db/repositories/videos.js";
import { createAnalysisRunRepository } from "../../apps/api/src/db/repositories/analysis-runs.js";
import { createAnalysisService } from "../../apps/api/src/analysis/analysis-service.js";
import { createLinkImportService, type LinkMetadata } from "../../apps/api/src/links/link-import-service.js";
import { createResultRepository } from "../../apps/api/src/results/result-repository.js";
import { createResultService } from "../../apps/api/src/results/result-service.js";

// Run real source uniqueness constraints, row locks and result deletion in an
// isolated schema. No remote video, model, SMTP or storage requests are made.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL deleted link reimport", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const videos = createVideoRepository(pool);
  const runs = createAnalysisRunRepository(pool);
  const results = createResultRepository(pool);
  const resultService = createResultService({ repository: results });
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const analysis = createAnalysisService({ videos, runs, queue });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrateDatabase(pool, fileURLToPath(new URL("../../apps/api/src/db/migrations", import.meta.url)));
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  async function user() {
    const id = randomUUID(), now = new Date();
    await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ($1,$2,'fixture',$3,$3)", [id, `${id}@example.test`, now]);
    return id;
  }
  function source(platform: "bilibili" | "youtube", part: number | null = null): LinkMetadata {
    return { platform, part, externalId: platform === "bilibili" ? "BV1AB411c7mD" : "dQw4w9WgXcQ",
      canonicalUrl: platform === "bilibili" ? `https://www.bilibili.com/video/BV1AB411c7mD?p=${part ?? 1}` : "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "重新分析的课程", author: "讲师", duration: 120, thumbnailUrl: "", isLive: false, subtitleLanguage: "zh" };
  }
  function importer(metadata: LinkMetadata) {
    return createLinkImportService({ repository: videos, inspector: { inspect: async () => metadata } });
  }
  async function complete(runId: string) {
    await pool.query("UPDATE analysis_runs SET status='completed', stage='completed', progress=1 WHERE id=$1", [runId]);
  }

  it.each(["bilibili", "youtube"] as const)("keeps a fresh %s analysis separate from its deleted result", async (platform) => {
    const userId = await user(), metadata = source(platform), service = importer(metadata);
    const firstVideo = await service.confirm({ userId, url: metadata.canonicalUrl });
    const first = await analysis.start({ userId, videoId: firstVideo.videoId });
    await complete(first.id);
    await resultService.delete({ userId, runId: first.id });
    expect((await videos.findOwnedById(userId, firstVideo.videoId))?.fileName).toBe(metadata.title);

    // Reproduce a source already corrupted by the old deletion implementation.
    await pool.query("UPDATE videos SET file_name='已删除的视频' WHERE id=$1", [firstVideo.videoId]);
    await expect(service.preview({ userId, url: metadata.canonicalUrl })).resolves.toMatchObject({ existingRunId: null, duplicateStatus: null, title: metadata.title });
    const nextVideo = await service.confirm({ userId, url: metadata.canonicalUrl });
    expect(nextVideo.videoId).toBe(firstVideo.videoId);
    const next = await analysis.start({ userId, videoId: nextVideo.videoId });
    expect(next.id).not.toBe(first.id);
    await expect(resultService.get({ userId, runId: next.id })).resolves.toMatchObject({ fileName: metadata.title, status: "queued", resultAvailability: "pending", resultsDeletedAt: null });
    await complete(next.id);
    await pool.query("INSERT INTO transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text) VALUES ($1,$2,$3,0,1,'new transcript')", [randomUUID(), userId, next.id]);
    await resultService.delete({ userId, runId: first.id });
    await expect(resultService.get({ userId, runId: first.id })).rejects.toMatchObject({ status: 410 });
    await expect(resultService.list({ userId, limit: 10 })).resolves.toMatchObject({ items: expect.arrayContaining([
      expect.objectContaining({ id: first.id, fileName: "已删除的视频", resultAvailability: "deleted" }),
      expect.objectContaining({ id: next.id, fileName: metadata.title, resultAvailability: "available" })
    ]) });
    await expect(resultService.get({ userId, runId: next.id })).resolves.toMatchObject({ transcript: { segments: [{ text: "new transcript" }] } });
  });

  it("keeps an active run discoverable when a newer deleted run exists", async () => {
    const userId = await user(), metadata = source("bilibili", 2), service = importer(metadata);
    const video = await service.confirm({ userId, url: metadata.canonicalUrl });
    const old = await analysis.start({ userId, videoId: video.videoId });
    await complete(old.id);
    const active = await analysis.start({ userId, videoId: video.videoId });
    await pool.query("UPDATE analysis_runs SET status='running' WHERE id=$1", [active.id]);
    await pool.query("UPDATE analysis_runs SET created_at=$2 WHERE id=$1", [old.id, new Date(Date.now() + 1000)]);
    await resultService.delete({ userId, runId: old.id });
    await expect(service.preview({ userId, url: metadata.canonicalUrl })).resolves.toMatchObject({ videoId: video.videoId, existingRunId: active.id, duplicateStatus: "running" });
    await expect(analysis.start({ userId, videoId: video.videoId })).resolves.toMatchObject({ id: active.id });
    expect((await videos.findOwnedById(userId, video.videoId))?.fileName).toBe(metadata.title);
  });

  it("does not offer expired privacy results as reusable analyses", async () => {
    const userId = await user(), metadata = source("youtube"), service = importer(metadata);
    const video = await service.confirm({ userId, url: metadata.canonicalUrl });
    const old = await analysis.start({ userId, videoId: video.videoId, retentionMode: "privacy" });
    await complete(old.id);
    await pool.query("UPDATE analysis_runs SET result_expires_at=$2 WHERE id=$1", [old.id, new Date(0)]);
    await expect(service.preview({ userId, url: metadata.canonicalUrl })).resolves.toMatchObject({ videoId: video.videoId, existingRunId: null });
    const next = await analysis.start({ userId, videoId: video.videoId });
    expect(next.id).not.toBe(old.id);
    await expect(resultService.get({ userId, runId: old.id })).rejects.toMatchObject({ status: 410 });
  });

  it("repairs legacy visible labels on read without restoring deleted or expired records", async () => {
    const userId = await user(), metadata = source("bilibili", 3), service = importer(metadata);
    const video = await service.confirm({ userId, url: metadata.canonicalUrl });
    const first = await analysis.start({ userId, videoId: video.videoId });
    await complete(first.id);
    await pool.query("UPDATE analysis_runs SET display_name='已删除的视频' WHERE id=$1", [first.id]);
    await pool.query("UPDATE videos SET file_name='已删除的视频' WHERE id=$1", [video.videoId]);
    await expect(resultService.get({ userId, runId: first.id })).resolves.toMatchObject({ fileName: "B站视频 · BV1AB411c7mD · P3", resultAvailability: "available" });
    await service.confirm({ userId, url: metadata.canonicalUrl });
    await expect(resultService.get({ userId, runId: first.id })).resolves.toMatchObject({ fileName: metadata.title });
    await resultService.delete({ userId, runId: first.id });
    await service.confirm({ userId, url: metadata.canonicalUrl });
    await expect(resultService.get({ userId, runId: first.id })).rejects.toMatchObject({ status: 410 });
    const ledger = await pool.query("SELECT COUNT(*)::int AS count FROM credit_ledger WHERE user_id=$1", [userId]);
    expect(ledger.rows[0].count).toBe(0);
  });

  it("upserts concurrent confirmations once and isolates owners and Bilibili parts", async () => {
    const userId = await user(), otherUser = await user(), metadata = source("bilibili", 1), service = importer(metadata);
    const confirmations = await Promise.all(Array.from({ length: 6 }, () => service.confirm({ userId, url: metadata.canonicalUrl })));
    expect(new Set(confirmations.map(item => item.videoId)).size).toBe(1);
    const ownVideoId = confirmations[0].videoId;
    const otherVideo = await service.confirm({ userId: otherUser, url: metadata.canonicalUrl });
    expect(otherVideo.videoId).not.toBe(ownVideoId);
    const part2 = source("bilibili", 2);
    const nextPart = await importer(part2).confirm({ userId, url: part2.canonicalUrl });
    expect(nextPart.videoId).not.toBe(ownVideoId);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM videos WHERE user_id=$1 AND source_part=1", [userId])).rows[0].count).toBe(1);
    const concurrentRuns = await Promise.all(Array.from({ length: 4 }, () => analysis.start({ userId, videoId: ownVideoId })));
    expect(new Set(concurrentRuns.map(item => item.id)).size).toBe(1);
    await expect(videos.findOwnedById(otherUser, ownVideoId)).resolves.toBeNull();
  });

  it("creates a new source record after explicit video deletion rather than reviving it", async () => {
    const userId = await user(), metadata = source("youtube"), service = importer(metadata);
    const old = await service.confirm({ userId, url: metadata.canonicalUrl });
    await videos.markDeleted(userId, old.videoId);
    const next = await service.confirm({ userId, url: metadata.canonicalUrl });
    expect(next.videoId).not.toBe(old.videoId);
    expect((await pool.query("SELECT status FROM videos WHERE id=$1", [old.videoId])).rows[0].status).toBe("deleted");
    await expect(videos.findOwnedById(userId, next.videoId)).resolves.toMatchObject({ fileName: metadata.title });
  });

  it("serializes concurrent old-result deletions and refresh without damaging the current result", async () => {
    const userId = await user(), metadata = source("bilibili"), service = importer(metadata);
    const video = await service.confirm({ userId, url: metadata.canonicalUrl });
    const old1 = await analysis.start({ userId, videoId: video.videoId });
    await complete(old1.id);
    const old2 = await analysis.start({ userId, videoId: video.videoId });
    await complete(old2.id);
    const current = await analysis.start({ userId, videoId: video.videoId });
    await pool.query("UPDATE analysis_runs SET status='running' WHERE id=$1", [current.id]);
    await pool.query("INSERT INTO transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text) VALUES ($1,$2,$3,0,1,'current result')", [randomUUID(), userId, current.id]);
    await Promise.all([
      resultService.delete({ userId, runId: old1.id }), resultService.delete({ userId, runId: old2.id }),
      service.confirm({ userId, url: metadata.canonicalUrl })
    ]);
    await complete(current.id);
    await expect(resultService.get({ userId, runId: current.id })).resolves.toMatchObject({ fileName: metadata.title, resultAvailability: "available", transcript: { segments: [{ text: "current result" }] } });
    await expect(resultService.get({ userId, runId: old1.id })).rejects.toMatchObject({ status: 410 });
    await expect(resultService.get({ userId, runId: old2.id })).rejects.toMatchObject({ status: 410 });
  });
});
