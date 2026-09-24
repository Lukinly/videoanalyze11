import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { RegisterPage } from "./RegisterPage";

describe("RegisterPage", () => {
  it("blocks registration when passwords do not match", async () => {
    const register = vi.spyOn(api, "register").mockResolvedValue({ userId: "user_1", verified: true });
    const user = userEvent.setup();
    render(<RegisterPage onLogin={() => undefined} />);
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.type(screen.getByLabelText("确认密码"), "different password");
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    expect(screen.getByText("两次输入的密码不一致")).toBeVisible();
    expect(register).not.toHaveBeenCalled();
    register.mockRestore();
  });

  it("requests a code and submits it with the registration", async () => {
    const sendCode = vi.spyOn(api, "sendRegistrationCode").mockResolvedValue({ sent: true, expiresInSeconds: 600 });
    const register = vi.spyOn(api, "register").mockResolvedValue({ userId: "user_1", verified: true });
    const user = userEvent.setup();
    render(<RegisterPage onLogin={() => undefined} />);
    expect(screen.getByText("十一 videoanalysis")).toBeVisible();

    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(sendCode).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(screen.getByLabelText("验证码")).toHaveAttribute("minLength", "6");
    expect(screen.getByLabelText("验证码")).toHaveAttribute("pattern", "[0-9]{6}");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.type(screen.getByLabelText("确认密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
      verificationCode: "123456"
    });
    sendCode.mockRestore();
    register.mockRestore();
  });

  it("does not request a code for an invalid email", async () => {
    const sendCode = vi.spyOn(api, "sendRegistrationCode").mockResolvedValue({ sent: true, expiresInSeconds: 600 });
    const user = userEvent.setup();
    render(<RegisterPage onLogin={() => undefined} />);
    await user.type(screen.getByLabelText("邮箱"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(sendCode).not.toHaveBeenCalled();
    sendCode.mockRestore();
  });
});
