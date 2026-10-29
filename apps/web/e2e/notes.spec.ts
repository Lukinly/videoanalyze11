import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory: string;
let video: Buffer;
let frame: string;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "notes-browser-"));
  const path = join(directory, "lesson.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=640x360:d=2", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", path]);
  video = await readFile(path);
  const jpeg = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "2.5", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
  frame = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function openNotes(page: Page, savedFrame: boolean, playback = true) {
  const run = { id: "notes-demo", videoId: "lesson", fileName: "课程演示.mp4", status: "completed", stage: "completed", sourcePlatform: "upload", resultAvailability: "available", transcript: {
    mergeWarnings: [], segments: [{ id: "start", runId: "notes-demo", start: 0.5, end: 1.5, text: "介绍问题" }, { id: "end", runId: "notes-demo", start: 2.5, end: 3.5, text: "理解核心概念" }]
  }, notes: { title: "从视频片段理解核心概念", topic: "将关键画面与讲解放在一起，按时间段回顾每一个知识点。", coreIdeas: ["结合原视频画面，理解每段讲解的上下文。"], reviewPoints: ["回看片段，复习概念之间的联系。"], sections: [{
    id: "background", level: 1, title: "背景与核心概念", body: "先从问题的背景出发，明确本节讨论的核心概念。画面与讲解一一对应，帮助理解当前片段中的信息。\n\n通过一个清晰的时间范围，可以直接回到这段视频，结合原始内容加深理解。",
    citations: [{ segmentId: "end", timestampSeconds: 2.5 }, { segmentId: "start", timestampSeconds: 0.5 }],
    ...(savedFrame ? { frame: { timestampSeconds: 2.5, dataUrl: frame } } : {})
  }] } };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/auth/me" ? { id: "reader", email: "reader@example.test", role: "user", status: "active", mustChangePassword: false }
      : path === "/api/credits" ? { available: 12, held: 0, ledgerBalance: 12 }
      : path === "/api/analysis-runs" ? { items: [run] }
      : path.endsWith("/playback-url") ? (playback ? { url: "/fixtures/lesson.mp4" } : { message: "original deleted" }) : run;
    await route.fulfill({ status: path.endsWith("/playback-url") && !playback ? 410 : 200, json: body });
  });
  await page.route("**/fixtures/lesson.mp4", (route) => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = Number(range?.[1] ?? 0);
    const end = Math.min(video.length - 1, Number(range?.[2] || video.length - 1));
    return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", body: video.subarray(start, end + 1), headers: {
      "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${video.length}` } : {})
    } });
  });
  await page.goto("/notes?run=notes-demo");
  await expect(page.getByRole("heading", { name: "从视频片段理解核心概念" })).toBeVisible();
}

test("shows one time range and keeps saved frames readable after original deletion on desktop and mobile", async ({ page }) => {
  await openNotes(page, true, false);
  await expect(page.locator(".note-time-range")).toHaveCount(1);
  await expect(page.locator(".note-time-range")).toHaveText("▷ 00:00:00 – 00:00:03");
  await expect(page.locator(".note-frame img")).toBeVisible();
  await expect(page.locator(".note-time-range")).toBeDisabled();
  await page.screenshot({ path: resolve(".local/screenshots/notes-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".note-frame img")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(".local/screenshots/notes-mobile.png"), fullPage: true });
});

test("extracts the correct attached-video frame without moving playback, then seeks from the range", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openNotes(page, false);
  const image = page.locator(".note-frame img");
  await expect(image).toBeVisible();
  const pixel = await image.evaluate(async (element) => {
    const img = element as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(pixel[2], JSON.stringify(pixel)).toBeGreaterThan(200);
  expect(pixel[0]).toBeLessThan(20);
  expect(await page.locator(".notes-player video").evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(0);
  await page.locator(".note-time-range").click();
  await expect.poll(() => page.locator(".notes-player video").evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(0.5);
  expect(errors).toEqual([]);
});
