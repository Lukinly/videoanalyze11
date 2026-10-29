import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

describe("ForgotPasswordPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the email, shows neutral confirmation and prevents immediate resend", async () => {
    const request = vi.spyOn(api, "forgotPassword").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ForgotPasswordPage initialEmail="user@example.com" onLogin={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    expect(request).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(screen.getByRole("status")).toHaveTextContent("如果该邮箱已注册");
    expect(screen.getByRole("button", { name: "60 秒后可重新发送" })).toBeDisabled();
  });

  it("allows retry after a failed request and provides a way back to login", async () => {
    const request = vi.spyOn(api, "forgotPassword").mockRejectedValue(new Error("offline"));
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<ForgotPasswordPage onLogin={onLogin} />);
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重置邮件发送失败");
    expect(screen.getByRole("button", { name: "发送重置链接" })).toBeEnabled();
    expect(request).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "返回登录" }));
    expect(onLogin).toHaveBeenCalledOnce();
  });
});
