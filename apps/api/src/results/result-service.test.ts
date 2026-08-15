import { describe, expect, it, vi } from "vitest";
import { createResultService } from "./result-service.js";

const now = new Date("2026-08-15T12:00:00.000Z");

describe("result service lifecycle", () => {
  it("returns privacy content before expiry and rejects it with HTTP 410 at expiry", async () => {
    const metadata = { id: "r1", status: "completed", retentionMode: "privacy" as const, resultExpiresAt: new Date("2026-08-15T13:00:00.000Z"), resultsDeletedAt: null };
    const repository = {
      findOwnedMetadata: vi.fn().mockResolvedValue(metadata),
      loadOwnedContent: vi.fn().mockResolvedValue({ transcript: { segments: [{ text: "private" }] } }),
      listOwned: vi.fn(), deleteOwnedResults: vi.fn()
    };
    const service = createResultService({ repository, clock: { now: () => now } });

    await expect(service.get({ userId: "u1", runId: "r1" })).resolves.toMatchObject({ resultAvailability: "available", transcript: { segments: [{ text: "private" }] } });
    repository.findOwnedMetadata.mockResolvedValue({ ...metadata, resultExpiresAt: now });
    await expect(service.get({ userId: "u1", runId: "r1" })).rejects.toMatchObject({ code: "RESULT_EXPIRED", status: 410 });
    expect(repository.loadOwnedContent).toHaveBeenCalledTimes(1);
  });

  it("marks deleted and pending history entries without loading content", async () => {
    const repository = {
      listOwned: vi.fn().mockResolvedValue([
        { id: "deleted", status: "completed", retentionMode: "standard", resultExpiresAt: null, resultsDeletedAt: now },
        { id: "pending", status: "running", retentionMode: "standard", resultExpiresAt: null, resultsDeletedAt: null }
      ]),
      findOwnedMetadata: vi.fn(), loadOwnedContent: vi.fn(), deleteOwnedResults: vi.fn()
    };
    const service = createResultService({ repository, clock: { now: () => now } });

    await expect(service.list({ userId: "u1", limit: 50 })).resolves.toEqual({ items: [
      expect.objectContaining({ id: "deleted", resultAvailability: "deleted" }),
      expect.objectContaining({ id: "pending", resultAvailability: "pending" })
    ] });
  });

  it("does not expose internal provider errors in history", async () => {
    const repository = {
      listOwned: vi.fn().mockResolvedValue([{ id: "failed", status: "failed", error: "provider response body", retentionMode: "standard", resultExpiresAt: null, resultsDeletedAt: null }]),
      findOwnedMetadata: vi.fn(), loadOwnedContent: vi.fn(), deleteOwnedResults: vi.fn()
    };
    const service = createResultService({ repository, clock: { now: () => now } });

    const history = await service.list({ userId: "u1", limit: 50 });

    expect(history.items[0]).not.toHaveProperty("error");
  });
});
