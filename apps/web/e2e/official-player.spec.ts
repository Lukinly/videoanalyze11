import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

function runFor(platform: "bilibili" | "youtube") {
  return {
    id: "official-player", videoId: "video-1", fileName: "学习方法分享", status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available", duration: 120,
    sourcePlatform: platform, sourceUrl: platform === "bilibili" ? "https://www.bilibili.com/video/BV1B7411m7LV?p=2" : "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    summary: { oneLineSummary: "理解核心概念", overallSummary: "结合视频和笔记复习。", chapters: [{ id: "ch1", title: "核心概念", start: 27, end: 98, summary: "用自己的语言解释概念。", bullets: [], sourceSegmentIds: ["seg1"] }] },
    transcript: { segments: [{ id: "seg1", runId: "official-player", start: 27, end: 98, text: "理解比记住更重要。" }], mergeWarnings: [] },
    notes: { title: "学习方法笔记", topic: "结合片段复习", coreIdeas: ["用自己的语言复述概念"], sections: [{ id: "s1", level: 1, title: "核心概念", body: "回到原始片段，加深对知识的理解。", citations: [{ segmentId: "seg1", timestampSeconds: 27 }] }], reviewPoints: ["结合练习检验理解"] }
  };
}

async function appRoutes(page: Page, platform: "bilibili" | "youtube") {
  const run = runFor(platform);
  const calls: string[] = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const body = path === "/api/auth/me" ? { id: "reader", email: "reader@example.test", role: "user", status: "active", mustChangePassword: false }
      : path === "/api/credits" ? { available: 12, held: 0, ledgerBalance: 12 }
      : path === "/api/analysis-runs" ? { items: [run] }
      : path === "/api/link-imports/preview" ? { videoId: null, existingRunId: null, platform, canonicalUrl: run.sourceUrl, title: run.fileName, author: "讲师", duration: 120, thumbnailUrl: "", subtitleLanguage: "zh", estimatedCost: 2 }
      : run;
    await route.fulfill({ json: body });
  });
  return calls;
}

const iframeFixture = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#242a39;color:white;display:grid;place-items:center;height:100vh;font:18px sans-serif"><div>官方播放器接口测试画面</div></body></html>`;

const youtubeFixture = `
window.YT = { Player: function(element, options) {
  var frame = document.createElement('iframe');
  frame.src = 'https://www.youtube.com/embed/' + options.videoId + '?enablejsapi=1&origin=' + encodeURIComponent(options.playerVars.origin);
  frame.width = '100%'; frame.height = '100%';
  element.replaceWith(frame);
  var time = 0;
  var player = { seekTo: function(seconds) { time = seconds; }, unMute: function() {}, setVolume: function() {}, getCurrentTime: function() { return time; }, getPlayerState: function() { return 2; }, getIframe: function() { return frame; }, destroy: function() { frame.remove(); } };
  window.__testYouTubePlayer = player;
  frame.onload = function() { options.events.onReady({ target: player }); };
  return player;
} };
window.onYouTubeIframeAPIReady();`;

async function stubPlayers(page: Page) {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "application/javascript", body: youtubeFixture }));
  await page.route("https://www.youtube.com/embed/**", (route) => route.fulfill({ contentType: "text/html", body: iframeFixture }));
  await page.route("https://player.bilibili.com/player.html?**", (route) => route.fulfill({ contentType: "text/html", body: iframeFixture }));
}

test("plays Bilibili in the workspace and seeks chapters and transcript without opening tabs", async ({ page, context }) => {
  const calls = await appRoutes(page, "bilibili");
  await stubPlayers(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?run=official-player");
  const frame = page.getByTitle("学习方法分享（B站官方播放器）");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /p=2/);
  await page.getByRole("button", { name: /00:27.*核心概念/ }).click();
  await expect(frame).toHaveAttribute("src", /t=27/);
  await expect(page.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", /p=2&t=27/);
  await page.getByRole("tab", { name: "逐字稿" }).click();
  await page.getByRole("button", { name: /00:27.*理解比记住更重要/ }).click();
  await expect(frame).toHaveAttribute("src", /t=27/);
  expect(context.pages()).toHaveLength(1);
  expect(calls.some((path) => path.endsWith("/playback-url"))).toBe(false);
  await expect(page.getByText("正在加载官方播放器…")).toHaveCount(0);
  await page.screenshot({ path: resolve(".local/screenshots/official-player-workspace.png") });
  expect(errors).toEqual([]);
});

test("loads the official player in notes and retains the Bilibili part on a narrow screen", async ({ page, context }) => {
  await appRoutes(page, "bilibili");
  await stubPlayers(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes?run=official-player");
  await page.getByRole("button", { name: /^回看核心概念/ }).click();
  await expect(page.getByTitle("学习方法分享（B站官方播放器）")).toHaveAttribute("src", /p=2.*t=27/);
  expect(context.pages()).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("controls YouTube through its API while keeping its iframe and an original-video link", async ({ page }) => {
  await appRoutes(page, "youtube");
  await stubPlayers(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?run=official-player");
  const frame = page.getByTitle("学习方法分享（YouTube 官方播放器）");
  await expect(frame).toBeVisible();
  const before = await frame.getAttribute("src");
  await page.getByRole("button", { name: /00:27.*核心概念/ }).click();
  await expect(frame).toHaveAttribute("src", before!);
  await expect(page.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", /t=27s/);
  await page.getByRole("link", { name: "查看 AI 笔记" }).click();
  await expect(page.getByRole("heading", { name: "学习方法笔记" })).toBeVisible();
  await expect(page.getByTitle("学习方法分享（YouTube 官方播放器）")).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows a playable preview after reading metadata, before starting AI analysis", async ({ page }) => {
  const calls = await appRoutes(page, "bilibili");
  await stubPlayers(page);
  await page.goto("/");
  await page.getByRole("button", { name: "输入链接解析" }).click();
  await page.getByLabel("视频链接").fill("https://www.bilibili.com/video/BV1B7411m7LV?p=2");
  await page.getByRole("button", { name: "读取视频信息" }).click();
  await expect(page.getByTitle("学习方法分享（B站官方播放器）")).toBeVisible();
  expect(calls.some((path) => path.endsWith("/confirm") || path.endsWith("/analysis-runs") && path !== "/api/analysis-runs")).toBe(false);
});

test("retains a working original-video link when the YouTube script is blocked", async ({ page }) => {
  await appRoutes(page, "youtube");
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await page.goto("/?run=official-player");
  await expect(page.getByRole("status")).toContainText("暂时无法加载");
  await expect(page.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", /youtube.com\/watch\?v=M7lc1UVf-VE/);
});
