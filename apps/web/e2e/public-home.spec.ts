import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const reader = { id: "reader", email: "reader@example.test", emailVerifiedAt: "2026-10-29T00:00:00.000Z", role: "user", status: "active", mustChangePassword: false };

async function mockApp(page: Page) {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/api/auth/me") return route.fulfill({ status: 401, json: { message: "login required" } });
    if (path === "/api/auth/login") return route.fulfill({ json: { user: reader } });
    if (path === "/api/credits") return route.fulfill({ json: { ledgerBalance: 12, held: 0, available: 12 } });
    if (path === "/api/analysis-runs") return route.fulfill({ json: { items: [] } });
    if (path === "/api/link-imports/preview") return route.fulfill({ json: { videoId: null, existingRunId: null, platform: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", title: "学习示例", author: "讲师", duration: 120, thumbnailUrl: "", subtitleLanguage: "zh", estimatedCost: 2 } });
    return route.fulfill({ status: 503, json: { message: "此操作已在测试中拦截" } });
  });
  return calls;
}

async function signIn(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("邮箱", { exact: true }).fill(reader.email);
  await dialog.getByLabel("密码", { exact: true }).fill("secure-password!");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("opens a public product page, then a dismissible login dialog with focus contained", async ({ page }) => {
  const calls = await mockApp(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把每段视频/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.every((path) => path === "/api/auth/me")).toBe(true);
  await page.getByRole("tab", { name: "时间轴" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("通过练习建立反馈");
  await page.getByRole("tab", { name: "AI 笔记" }).click();
  await page.screenshot({ path: resolve(".local/screenshots/public-home-desktop.png"), fullPage: true });
  const login = page.getByRole("button", { name: "登录", exact: true });
  await login.click();
  await expect(page.getByRole("dialog", { name: "登录你的工作台" })).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeFocused();
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  }
  await page.screenshot({ path: resolve(".local/screenshots/login-dialog-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(login).toBeFocused();
  await login.click();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("requires login for link inspection and preserves the entered URL after success", async ({ page }) => {
  const calls = await mockApp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "输入链接解析" }).click();
  await page.getByLabel("视频链接").fill("https://youtu.be/abcdefghijk");
  await page.getByRole("button", { name: "读取视频信息" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(calls).not.toContain("/api/link-imports/preview");
  await signIn(page);
  await expect(page.getByLabel("视频链接")).toHaveValue("https://youtu.be/abcdefghijk");
  await page.getByRole("button", { name: "读取视频信息" }).click();
  await expect(page.getByRole("heading", { name: "学习示例" })).toBeVisible();
  expect(calls).toContain("/api/link-imports/preview");
});

test("requires login before upload and retains the chosen file", async ({ page }) => {
  const calls = await mockApp(page);
  await page.goto("/");
  await page.getByLabel("选择用于分析的视频").setInputFiles({ name: "my-lesson.mp4", mimeType: "video/mp4", buffer: Buffer.from("test video") });
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(calls).not.toContain("/api/videos/upload-session");
  await signIn(page);
  await expect(page.getByRole("button", { name: "my-lesson.mp4" })).toBeVisible();
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText("此操作已在测试中拦截")).toBeVisible();
  expect(calls).toContain("/api/videos/upload-session");
});

test("keeps the public page and account flows usable on a narrow screen", async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(".local/screenshots/public-home-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "输入链接解析" }).click();
  await page.getByLabel("视频链接").fill("https://youtu.be/abcdefghijk");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "读取视频信息" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(reader.email);
  await page.getByRole("button", { name: "忘记密码？" }).click();
  await expect(page.getByRole("dialog", { name: "忘记密码" })).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(reader.email);
  await page.getByRole("button", { name: "返回登录" }).click();
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "创建账号" })).toBeVisible();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: resolve(".local/screenshots/register-dialog-mobile.png") });
  await page.getByRole("button", { name: "关闭登录窗口" }).click();
  await expect(page.getByLabel("视频链接")).toHaveValue("https://youtu.be/abcdefghijk");
});
