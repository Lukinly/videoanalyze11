import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { AdminPage } from "./AdminPage";

describe("AdminPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders user management and top-up review controls for an admin", async () => {
    vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [{ id: "u1", email: "user@example.com", emailVerifiedAt: null, role: "user", status: "active", mustChangePassword: false, ledgerBalance: 12, held: 0, available: 12 }] });
    vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [] });
    render(<AdminPage />);
    expect(await screen.findByText("user@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "调整积分" })).toBeVisible();
  });

  it("shows who submitted each top-up request", async () => {
    vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({
      items: [
        {
          id: "request_1",
          userId: "user_1",
          userEmail: "applicant@example.com",
          requestedAmount: 30,
          note: "bank transfer",
          status: "pending",
          createdAt: "2026-08-11T08:30:00.000Z"
        },
        {
          id: "request_2",
          userId: "deleted_user",
          userEmail: null,
          requestedAmount: 10,
          note: "",
          status: "pending",
          createdAt: "2026-08-11T09:00:00.000Z"
        }
      ]
    });

    render(<AdminPage />);

    expect(await screen.findByText("applicant@example.com")).toBeVisible();
    expect(screen.getByText("用户 ID：user_1")).toBeVisible();
    expect(screen.getByText("申请金额：30 积分")).toBeVisible();
    expect(screen.getByText("备注：bank transfer")).toBeVisible();
    expect(screen.getByText("未知用户")).toBeVisible();
    expect(screen.getByText("用户 ID：deleted_user")).toBeVisible();
  });

  it("creates an ordinary account once, adds it to the list and clears the password form", async () => {
    vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [] });
    let complete!: (value: Awaited<ReturnType<typeof api.createAdminUser>>) => void;
    const create = vi.spyOn(api, "createAdminUser").mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(screen.getByRole("button", { name: "新增普通账号" }));
    await user.type(screen.getByLabelText("邮箱"), "new@example.com");
    await user.type(screen.getByLabelText("初始密码", { exact: true }), "initial password");
    await user.type(screen.getByLabelText("确认初始密码"), "initial password");
    await user.type(screen.getByLabelText("创建原因（选填）"), "support request");
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "创建中…" }));
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ email: "new@example.com", password: "initial password", confirmPassword: "initial password", reason: "support request" });
    complete({ user: { id: "new-user", email: "new@example.com", emailVerifiedAt: "2026-10-30T00:00:00Z", role: "user", status: "active", mustChangePassword: true }, welcomeCredits: 12 });
    expect(await screen.findByRole("status")).toHaveTextContent("已创建 new@example.com");
    expect(screen.getByText("new@example.com")).toBeVisible();
    expect(screen.getByText(/12 积分可用.*待修改初始密码/)).toBeVisible();
    expect(screen.queryByLabelText("初始密码", { exact: true })).toBeNull();
  });

  it("rejects mismatched passwords without requesting account creation", async () => {
    vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [] });
    const create = vi.spyOn(api, "createAdminUser");
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(screen.getByRole("button", { name: "新增普通账号" }));
    await user.type(screen.getByLabelText("邮箱"), "new@example.com");
    await user.type(screen.getByLabelText("初始密码", { exact: true }), "initial password");
    await user.type(screen.getByLabelText("确认初始密码"), "different password");
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the email but clears passwords after a duplicate-email error", async () => {
    vi.spyOn(api, "listAdminUsers").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listAdminCreditRequests").mockResolvedValue({ items: [] });
    vi.spyOn(api, "createAdminUser").mockRejectedValue(new ApiError("该邮箱已存在，请使用其他邮箱", 409, "EMAIL_ALREADY_REGISTERED"));
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(screen.getByRole("button", { name: "新增普通账号" }));
    await user.type(screen.getByLabelText("邮箱"), "existing@example.com");
    await user.type(screen.getByLabelText("初始密码", { exact: true }), "initial password");
    await user.type(screen.getByLabelText("确认初始密码"), "initial password");
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("该邮箱已存在");
    expect(screen.getByLabelText("邮箱")).toHaveValue("existing@example.com");
    expect(screen.getByLabelText("初始密码", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("确认初始密码")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("form", { name: "新增普通账号" })).toBeNull();
  });
});
