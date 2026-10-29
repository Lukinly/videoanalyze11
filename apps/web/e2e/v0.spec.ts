import { expect, test } from "@playwright/test";

test.describe("V0 web shell", () => {
  test("shows the public home and opens login only on request", async ({ page }) => {
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { message: "login required" } }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /把每段视频/ })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
  });
});
