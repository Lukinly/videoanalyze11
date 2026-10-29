import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { ResetPasswordPage } from "./ResetPasswordPage";

describe("ResetPasswordPage", () => {
  afterEach(() => vi.restoreAllMocks());
  it("submits a reset password form", async () => {
    const reset = vi.spyOn(api, "resetPassword").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ResetPasswordPage token="reset-token" onDone={() => undefined} />);
    await user.type(screen.getByLabelText("新密码"), "new secure password");
    await user.type(screen.getByLabelText("确认密码"), "new secure password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(reset).toHaveBeenCalledWith({ token: "reset-token", password: "new secure password", confirmPassword: "new secure password" });
  });

  it("lets users request a new link when the previous link has expired", async () => {
    vi.spyOn(api, "resetPassword").mockRejectedValue(new ApiError("expired", 400, "INVALID_RESET_TOKEN"));
    const onRequestReset = vi.fn();
    const user = userEvent.setup();
    render(<ResetPasswordPage token="expired-token" onDone={() => undefined} onRequestReset={onRequestReset} />);
    await user.type(screen.getByLabelText("新密码"), "new secure password");
    await user.type(screen.getByLabelText("确认密码"), "new secure password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重置链接已失效或已使用");
    await user.click(screen.getByRole("button", { name: "重新获取重置链接" }));
    expect(onRequestReset).toHaveBeenCalledOnce();
  });

  it("sends only one request when the form is submitted twice before the response", async () => {
    let resolveReset!: (result: { ok: true }) => void;
    const reset = vi.spyOn(api, "resetPassword").mockImplementation(() => new Promise((resolve) => { resolveReset = resolve; }));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ResetPasswordPage token="fresh-token" onDone={onDone} />);
    await user.type(screen.getByLabelText("新密码"), "new secure password");
    await user.type(screen.getByLabelText("确认密码"), "new secure password");
    const form = screen.getByRole("button", { name: "保存新密码" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(reset).toHaveBeenCalledTimes(1);
    await act(async () => { resolveReset({ ok: true }); });
    expect(onDone).toHaveBeenCalledOnce();
  });
});
