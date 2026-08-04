import { describe, expect, it, vi } from "vitest";
import { deleteVideo } from "./videos-delete.js";

describe("video deletion", () => {
  it("deletes all user-owned analysis objects", async () => {
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const videos = {
      listOwnedObjectKeys: vi.fn().mockResolvedValue([
        "users/u1/videos/v1/original",
        "users/u1/runs/r1/audio.flac",
        "users/u1/runs/r1/summary.json"
      ]),
      markDeleted: vi.fn().mockResolvedValue(undefined)
    };

    await deleteVideo({ userId: "u1", videoId: "v1", videos, storage });

    expect(storage.delete).toHaveBeenCalledWith("users/u1/videos/v1/original");
    expect(storage.delete).toHaveBeenCalledWith("users/u1/runs/r1/audio.flac");
    expect(storage.delete).toHaveBeenCalledWith("users/u1/runs/r1/summary.json");
    expect(videos.markDeleted).toHaveBeenCalledWith("u1", "v1");
  });
});
