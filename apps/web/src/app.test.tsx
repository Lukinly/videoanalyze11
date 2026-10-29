import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api/client";
import { App } from "./app";

const signedInUser = { id: "user-1", email: "user@example.com", emailVerifiedAt: "2026-08-11T00:00:00.000Z", role: "user" as const, status: "active" as const, mustChangePassword: false };

describe("App", () => {
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

  it("opens password recovery from login with the entered email", async () => {
    window.history.replaceState({}, "", "/");
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.type(await screen.findByLabelText("邮箱"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "忘记密码？" }));
    expect(screen.getByRole("heading", { name: "忘记密码" })).toBeVisible();
    expect(screen.getByLabelText("邮箱")).toHaveValue("user@example.com");
    expect(window.location.pathname).toBe("/");
    await user.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
  });

  it("returns to login with a success message after resetting a password", async () => {
    window.history.replaceState({}, "", "/reset-password?token=reset-token");
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    vi.spyOn(api, "resetPassword").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("新密码"), "new secure password");
    await user.type(screen.getByLabelText("确认密码"), "new secure password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(await screen.findByRole("heading", { name: "登录你的工作台" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("密码已重置，请使用新密码登录。");
    expect(window.location.search).toBe("");
  });

  it("renders the public UI immediately without requesting private content or opening login", () => {
    vi.spyOn(api, "getMe").mockImplementation(() => new Promise(() => {}));
    const credits = vi.spyOn(api, "getCredits");
    const history = vi.spyOn(api, "listAnalyses");
    render(<App />);
    expect(screen.getByRole("heading", { name: /把每段视频/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "产品示例预览" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(credits).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it("opens login on demand, allows registration in the dialog, and returns focus on close", async () => {
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    const user = userEvent.setup();
    render(<App />);
    const login = screen.getByRole("button", { name: "登录" });
    await user.click(login);
    expect(screen.getByRole("dialog", { name: "登录你的工作台" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "注册账号" }));
    expect(screen.getByRole("dialog", { name: "创建账号" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(login).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("requires login before uploading and keeps the selected file after login", async () => {
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    vi.spyOn(api, "login").mockResolvedValue({ user: signedInUser });
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 0, available: 12 });
    vi.spyOn(api, "listAnalyses").mockResolvedValue({ items: [] });
    const upload = vi.spyOn(api, "createUploadSession").mockRejectedValue(new Error("test upload unavailable"));
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("选择用于分析的视频"), new File(["video"], "my-lesson.mp4", { type: "video/mp4" }));
    await user.click(screen.getByRole("button", { name: "上传并分析" }));
    expect(upload).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("邮箱"), "user@example.com");
    await user.type(dialog.getByLabelText("密码"), "password123");
    await user.click(dialog.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "my-lesson.mp4" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "上传并分析" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ fileName: "my-lesson.mp4" })));
    await screen.findByText("test upload unavailable");
  });

  it("does not inspect a guest link and preserves it when login is dismissed", async () => {
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    const preview = vi.spyOn(api, "previewLink");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "输入链接解析" }));
    await user.type(screen.getByLabelText("视频链接"), "https://youtu.be/abcdefghijk");
    await user.click(screen.getByRole("button", { name: "读取视频信息" }));
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭登录窗口" }));
    expect(screen.getByLabelText("视频链接")).toHaveValue("https://youtu.be/abcdefghijk");
  });

  it("restores a protected video link after signing in without losing the requested URL", async () => {
    window.history.replaceState({}, "", "/?run=run-history");
    vi.spyOn(api, "getMe").mockRejectedValue(new Error("unauthorized"));
    vi.spyOn(api, "login").mockResolvedValue({ user: signedInUser });
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 0, available: 12 });
    vi.spyOn(api, "listAnalyses").mockResolvedValue({ items: [] });
    const detail = vi.spyOn(api, "getAnalysis").mockResolvedValue({ id: "run-history", videoId: "video-1", fileName: "history.mp4", status: "completed", stage: "completed" });
    vi.spyOn(api, "getPlaybackUrl").mockRejectedValue(new Error("original deleted"));
    const user = userEvent.setup();
    render(<App />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(detail).not.toHaveBeenCalled();
    await user.type(dialog.getByLabelText("邮箱"), signedInUser.email);
    await user.type(dialog.getByLabelText("密码"), "password123");
    await user.click(dialog.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { name: "history.mp4" })).toBeVisible();
    expect(detail).toHaveBeenCalledWith("run-history");
    expect(window.location.search).toBe("?run=run-history");
  });

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
