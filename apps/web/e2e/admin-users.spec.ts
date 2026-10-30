import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("an administrator creates an ordinary account and its first login requires a new password", async ({ page }) => {
  const admin = { id: "admin", email: "admin@example.test", emailVerifiedAt: "2026-10-30T00:00:00Z", role: "admin", status: "active", mustChangePassword: false };
  let reader = { ...admin, id: "reader", email: "manual-reader@example.test", role: "user", mustChangePassword: true };
  let current = admin;
  let created = false;
  const creations: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: current });
    if (path === "/api/credits") return route.fulfill({ json: { ledgerBalance: 12, held: 0, available: 12 } });
    if (path === "/api/analysis-runs" || path === "/api/admin/credit-requests") return route.fulfill({ json: { items: [] } });
    if (path === "/api/admin/users" && request.method() === "GET") return route.fulfill({ json: { items: created ? [{ ...reader, ledgerBalance: 12, held: 0, available: 12 }] : [] } });
    if (path === "/api/admin/users" && request.method() === "POST") {
      creations.push(request.postDataJSON());
      created = true;
      return route.fulfill({ status: 201, json: { user: reader, welcomeCredits: 12 } });
    }
    if (path === "/api/auth/login") {
      current = reader;
      return route.fulfill({ json: { user: reader } });
    }
    if (path === "/api/auth/change-password") {
      expect(request.postDataJSON()).toEqual({ password: "reader-new-password!", confirmPassword: "reader-new-password!" });
      reader = { ...reader, mustChangePassword: false };
      current = reader;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 503, json: { message: "Unexpected test request" } });
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "新增普通账号" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(reader.email);
  await page.getByLabel("初始密码", { exact: true }).fill("initial-reader-password!");
  await page.getByLabel("确认初始密码").fill("mismatched-password!");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("两次输入的密码不一致");
  expect(creations).toHaveLength(0);
  await page.getByLabel("确认初始密码").fill("initial-reader-password!");
  await page.screenshot({ path: resolve(".local/screenshots/admin-create-user-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(".local/screenshots/admin-create-user-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`已创建 ${reader.email}`);
  await expect(page.getByText(reader.email, { exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "新增普通账号" })).toHaveCount(0);
  expect(creations).toEqual([{ email: reader.email, password: "initial-reader-password!", confirmPassword: "initial-reader-password!", reason: "" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Restore the new user's session to check the real application navigation guard.
  current = reader;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传并分析" })).toHaveCount(0);
  await page.getByLabel("新密码", { exact: true }).fill("reader-new-password!");
  await page.getByLabel("确认密码", { exact: true }).fill("reader-new-password!");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: /把每段视频/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "后台", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
