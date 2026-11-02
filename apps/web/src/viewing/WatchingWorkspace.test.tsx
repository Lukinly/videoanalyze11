import { createRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AnalysisRun, CreditBalance, PublicUser } from "../api/client";
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
const completedRun: AnalysisRun = { id: "run-1", videoId: "video-1", fileName: "demo.mp4", duration: 120, status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available" };
describe("WatchingWorkspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["failed", "cancelled"])("updates the header and sidebar after polling a %s run", async (status) => {
    const terminal: AnalysisRun = { ...completedRun, status, stage: "transcribing", progress: 0.2, failure: status === "failed" ? { code: "ASR_ACCESS_DENIED", message: "语音识别服务拒绝了请求，请联系管理员检查服务权限和网络配置。" } : undefined };
    vi.spyOn(client.api, "getAnalysis").mockResolvedValue(terminal);
    const close = vi.fn();
    vi.spyOn(client, "subscribeToAnalysis").mockReturnValue(close);
    const finished = vi.fn();
    function Workspace() {
      const [current, setCurrent] = useState<AnalysisRun>({ ...completedRun, status: "running", stage: "transcribing" });
      return <WatchingWorkspace user={user} credits={credits} video={video} run={current} playerRef={createRef<PlayerController>()} onTerminal={(run) => { finished(run); setCurrent(run); }} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />;
    }
    render(<Workspace />);
    expect(await screen.findByText(status === "failed" ? "AI 分析失败" : "AI 分析已取消")).toBeVisible();
    expect(screen.getByText("本次分析已停止")).toBeVisible();
    expect(screen.queryByText("AI 正在分析视频内容")).not.toBeInTheDocument();
    expect(screen.queryByText("分析结果将自动更新")).not.toBeInTheDocument();
    expect(screen.queryByText("等待摘要")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
    expect(finished).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(close).toHaveBeenCalled();
    if (status === "failed") expect(screen.getByText(terminal.failure!.message)).toBeVisible();
  });

  it("renders the immersive player and content navigation", async () => {
    const userEventApi = userEvent.setup();
    const { container } = render(<WatchingWorkspace user={user} credits={credits} video={video} run={null} playerRef={createRef<PlayerController>()} onTerminal={vi.fn()} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />);

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
      const { unmount } = render(<WatchingWorkspace user={user} credits={credits} video={video} run={null} playerRef={createRef<PlayerController>()} onTerminal={vi.fn()} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />);
      unmount();
      expect(revoke).toHaveBeenCalledWith("blob:demo");
    } finally {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("hides local-player controls for a remote video while keeping result actions", () => {
    const remoteVideo: UploadedVideo = {
      ...video,
      playbackUrl: "",
      sourcePlatform: "bilibili",
      sourceUrl: "https://www.bilibili.com/video/BV1AB411c7mD?p=2"
    };

    render(<WatchingWorkspace user={user} credits={credits} video={remoteVideo} run={completedRun} playerRef={createRef<PlayerController>()} onTerminal={vi.fn()} onLogout={vi.fn()} onAttach={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "开启声音" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重新选择本地原视频")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 Markdown" })).toBeVisible();
    expect(screen.getByRole("button", { name: "永久删除结果" })).toBeVisible();
    expect(screen.getByTitle("demo.mp4（B站官方播放器）")).toHaveAttribute("src", expect.stringContaining("p=2"));
    expect(screen.getByRole("link", { name: /打开原视频/ })).toBeVisible();
  });
});
