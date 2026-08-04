import { expect, test } from "@playwright/test";

test.describe("V0 web shell", () => {
  test("shows the sign-in entry point", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
  });
});
