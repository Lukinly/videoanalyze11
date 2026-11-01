import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

async function mockMemberHome(page: Page) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const reader = { id: "reader", email: "reader@example.test", emailVerifiedAt: "2026-11-01T00:00:00Z", role: "user", status: "active", mustChangePassword: false };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: reader });
    if (path === "/api/credits") return route.fulfill({ json: { ledgerBalance: 5201324, held: 0, available: 5201324 } });
    if (path === "/api/analysis-runs" && request.method() === "GET") return route.fulfill({ json: { items: [{ id: "previous", videoId: "previous-video", fileName: "previous-lesson.mp4", status: "completed", stage: "completed", resultAvailability: "available" }] } });
    if (path === "/api/videos/upload-session") {
      calls.push({ path, body: request.postDataJSON() });
      return route.fulfill({ json: { videoId: "uploaded-video", objectKey: "test", fileSize: 10, uploadUrl: new URL("/test-upload", request.url()).href } });
    }
    if (path === "/api/videos/uploaded-video/analysis-runs") {
      calls.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 202, json: { id: "new-run", videoId: "uploaded-video", stage: "queued", status: "queued" } });
    }
    if (path === "/api/analysis-runs/new-run/events") return route.fulfill({ contentType: "text/event-stream", body: "event: progress\ndata: {\"status\":\"queued\",\"stage\":\"queued\"}\n\n" });
    if (path === "/api/analysis-runs/new-run") return route.fulfill({ json: { id: "new-run", videoId: "uploaded-video", stage: "queued", status: "queued" } });
    if (path === "/api/link-imports/preview") {
      calls.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 503, json: { message: "链接功能测试响应" } });
    }
    return route.fulfill({ status: 503, json: { message: "Unexpected test request" } });
  });
  await page.route("**/test-upload", (route) => route.fulfill({ status: 204 }));
  return calls;
}

test("keeps the signed-in upload form readable and starts an analysis with the selected retention mode", async ({ page }) => {
  const calls = await mockMemberHome(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("reader@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /previous-lesson/ })).toHaveAttribute("href", "/notes?run=previous");
  await page.screenshot({ path: resolve(".local/screenshots/signed-in-home-desktop.png"), fullPage: true });
  const copy = await page.locator(".upload-copy").boundingBox();
  const hero = await page.locator(".hero-copy").boundingBox();
  const card = await page.locator(".source-picker > .upload-card").boundingBox();
  expect(copy!.width).toBeGreaterThan(300);
  expect(hero!.y).toBeLessThan(300);
  expect(card!.height).toBeLessThan(650);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("radio", { name: /隐私/ }).check();
  await page.getByLabel("选择用于分析的视频").setInputFiles({ name: "lesson.mp4", mimeType: "video/mp4", buffer: Buffer.from("test video") });
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("heading", { name: "lesson.mp4", exact: true })).toBeVisible();
  expect(calls).toContainEqual({ path: "/api/videos/upload-session", body: { fileName: "lesson.mp4", contentType: "video/mp4", contentLength: 10 } });
  expect(calls).toContainEqual({ path: "/api/videos/uploaded-video/analysis-runs", body: { retentionMode: "privacy" } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [1024, 768, 390]) {
  test(`keeps signed-in upload and link controls usable at ${width}px`, async ({ page }) => {
    const calls = await mockMemberHome(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "最近分析" })).toBeVisible();
    await page.getByRole("button", { name: "选择视频", exact: true }).scrollIntoViewIfNeeded();
    const button = await page.getByRole("button", { name: "选择视频", exact: true }).boundingBox();
    expect(button!.width).toBeGreaterThan(85);
    expect(button!.height).toBeLessThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(`.local/screenshots/signed-in-home-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "输入链接解析" }).click();
    await page.getByLabel("视频链接").fill("https://youtu.be/abcdefghijk");
    const input = await page.getByLabel("视频链接").boundingBox();
    expect(input!.width).toBeGreaterThan(width < 560 ? 220 : 300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(`.local/screenshots/signed-in-link-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "读取视频信息" }).click();
    await expect(page.getByRole("alert")).toHaveText("链接功能测试响应");
    expect(calls).toContainEqual({ path: "/api/link-imports/preview", body: { url: "https://youtu.be/abcdefghijk" } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
