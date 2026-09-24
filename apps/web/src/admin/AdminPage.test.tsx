import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
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
});
