import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ResetPasswordPage } from "./ResetPasswordPage";

describe("ResetPasswordPage", () => {
  it("submits a reset password form", async () => {
    const reset = vi.spyOn(api, "resetPassword").mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ResetPasswordPage token="reset-token" onDone={() => undefined} />);
    await user.type(screen.getByLabelText("新密码"), "new secure password");
    await user.type(screen.getByLabelText("确认密码"), "new secure password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(reset).toHaveBeenCalledWith({ token: "reset-token", password: "new secure password", confirmPassword: "new secure password" });
  });
});
