import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CreditsPanel } from "./CreditsPanel";

describe("CreditsPanel", () => {
  it("shows the current balance and allows a top-up request", async () => {
    vi.spyOn(api, "getCredits").mockResolvedValue({ ledgerBalance: 12, held: 2, available: 10 });
    vi.spyOn(api, "getCreditLedger").mockResolvedValue({ items: [] });
    vi.spyOn(api, "getCreditRequests").mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    render(<CreditsPanel />);
    expect(await screen.findByText("10 积分")).toBeVisible();
    await user.type(screen.getByLabelText("充值积分"), "50");
    expect(screen.getByRole("button", { name: "提交充值申请" })).toBeVisible();
  });
});
