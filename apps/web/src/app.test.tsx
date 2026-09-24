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
});
