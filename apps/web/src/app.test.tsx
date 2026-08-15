import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api/client";
import { App } from "./app";

describe("App", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a focused welcome and upload page before a video is selected", async () => {
    window.history.replaceState({}, "", "/");
    vi.spyOn(api, "getMe").mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      emailVerifiedAt: "2026-08-11T00:00:00.000Z",
      role: "user",
      status: "active",
      mustChangePassword: false
    });
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 0, available: 12 });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /把每段视频/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "选择视频" })).toBeVisible();
    expect(screen.queryByText("积分余额")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "章节" })).not.toBeInTheDocument();
    expect(screen.getByText("十一 videoanalysis")).toBeVisible();
  });

  it("restores an authorized historical run from the URL after a fresh mount", async () => {
    window.history.replaceState({}, "", "/?run=run-history");
    vi.spyOn(api, "getMe").mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerifiedAt: "2026-08-11T00:00:00.000Z", role: "user", status: "active", mustChangePassword: false });
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 0, available: 12 });
    vi.spyOn(api, "listAnalyses").mockResolvedValue({ items: [] });
    vi.spyOn(api, "getAnalysis").mockResolvedValue({ id: "run-history", videoId: "video-1", fileName: "history.mp4", duration: 90, status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available" });
    vi.spyOn(api, "getPlaybackUrl").mockRejectedValue(Object.assign(new Error("gone"), { status: 410 }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "history.mp4" })).toBeVisible();
    expect(api.getAnalysis).toHaveBeenCalledWith("run-history");
    expect(screen.getByLabelText("重新选择本地原视频")).toBeInTheDocument();
  });

  it("keeps the authenticated home page when a historical run is unavailable", async () => {
    window.history.replaceState({}, "", "/?run=missing");
    vi.spyOn(api, "getMe").mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerifiedAt: "2026-08-11T00:00:00.000Z", role: "user", status: "active", mustChangePassword: false });
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 0, available: 12 });
    vi.spyOn(api, "listAnalyses").mockResolvedValue({ items: [] });
    vi.spyOn(api, "getAnalysis").mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: /把每段视频/ })).toBeVisible();
  });
});
