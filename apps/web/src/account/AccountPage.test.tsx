import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type PublicUser } from "../api/client";
import { AccountPage } from "./AccountPage";

const user: PublicUser = {
  id: "user-1",
  email: "user@example.com",
  emailVerifiedAt: "2026-08-11T00:00:00.000Z",
  role: "user",
  status: "active",
  mustChangePassword: false
};

describe("AccountPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows credits and changes the signed-in user's password", async () => {
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 2, available: 10 });
    vi.spyOn(api, "getCreditLedger").mockResolvedValue({ items: [] });
    vi.spyOn(api, "getCreditRequests").mockResolvedValue({ items: [] });
    vi.spyOn(api, "changePassword").mockResolvedValue({ ok: true });
    const userEventApi = userEvent.setup();

    const { container } = render(<AccountPage user={user} onLogout={vi.fn()} />);

    expect(container.querySelector(".account-shell")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "个人中心" })).toBeVisible();
    expect(screen.getByText("十一 videoanalysis")).toBeVisible();
    expect(screen.getByText(user.email)).toBeVisible();
    expect(await screen.findByText("10 积分")).toBeVisible();

    await userEventApi.type(screen.getByLabelText("新密码"), "new secure password");
    await userEventApi.type(screen.getByLabelText("确认密码"), "new secure password");
    await userEventApi.click(screen.getByRole("button", { name: "保存新密码" }));

    expect(await screen.findByText("密码已更新。")).toBeVisible();
  });
});
