import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CreditBalance, PublicUser } from "../api/client";
import type { UploadedVideo } from "../library/UploadVideo";
import type { PlayerController } from "../player/VideoPlayer";
import { WatchingWorkspace } from "./WatchingWorkspace";

const user: PublicUser = {
  id: "user-1",
  email: "user@example.com",
  emailVerifiedAt: "2026-08-11T00:00:00.000Z",
  role: "user",
  status: "active",
  mustChangePassword: false
};

const credits: CreditBalance = { ledgerBalance: 12, held: 2, available: 10 };
const video: UploadedVideo = { videoId: "video-1", fileName: "demo.mp4", playbackUrl: "blob:demo", fileSize: 100, estimatedCost: 1, retentionMode: "standard" };
describe("WatchingWorkspace", () => {
  it("renders the immersive player and content navigation", async () => {
    const userEventApi = userEvent.setup();
    const { container } = render(<WatchingWorkspace user={user} credits={credits} video={video} run={null} playerRef={createRef<PlayerController>()} onCompleted={vi.fn()} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />);

    expect(container.querySelector(".watching-shell")).not.toBeNull();
    expect(container.querySelector(".watching-stage")).not.toBeNull();
    expect(container.querySelector(".viewing-sidebar")).not.toBeNull();
    expect(screen.getByLabelText("demo.mp4")).toBeVisible();
    expect(screen.getByRole("tab", { name: "章节笔记" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "逐字稿" })).toBeVisible();
    const player = screen.getByLabelText("demo.mp4") as HTMLVideoElement;
    player.muted = true;
    player.volume = 0;
    await userEventApi.click(screen.getByRole("button", { name: "开启声音" }));
    expect(player.muted).toBe(false);
    expect(player.volume).toBe(1);
  });

  it("revokes an owned blob playback URL on unmount", () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    try {
      const { unmount } = render(<WatchingWorkspace user={user} credits={credits} video={video} run={null} playerRef={createRef<PlayerController>()} onCompleted={vi.fn()} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />);
      unmount();
      expect(revoke).toHaveBeenCalledWith("blob:demo");
    } finally {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
});
