import { afterEach, describe, expect, it, vi } from "vitest";
import type { YouTubeApi } from "./youtube-api";

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]').forEach((script) => script.remove());
  vi.useRealTimers();
  vi.resetModules();
});

describe("YouTube API loader", () => {
  it("shares one official script across players and preserves an existing ready callback", async () => {
    const { loadYouTubeApi } = await import("./youtube-api");
    const previous = vi.fn();
    window.onYouTubeIframeAPIReady = previous;
    const first = loadYouTubeApi();
    expect(loadYouTubeApi()).toBe(first);
    expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);
    const api = { Player: class {} } as unknown as YouTubeApi;
    window.YT = api;
    window.onYouTubeIframeAPIReady!();
    await expect(first).resolves.toBe(api);
    expect(previous).toHaveBeenCalledOnce();
    expect(window.onYouTubeIframeAPIReady).toBe(previous);
  });

  it("rejects blocked scripts and allows a later attempt", async () => {
    const { loadYouTubeApi } = await import("./youtube-api");
    const first = loadYouTubeApi();
    const rejection = expect(first).rejects.toThrow(/暂时无法加载/);
    document.querySelector('script[src="https://www.youtube.com/iframe_api"]')!.dispatchEvent(new Event("error"));
    await rejection;
    const second = loadYouTubeApi();
    expect(second).not.toBe(first);
    const secondRejection = expect(second).rejects.toThrow();
    document.querySelector('script[src="https://www.youtube.com/iframe_api"]')!.dispatchEvent(new Event("error"));
    await secondRejection;
  });

  it("fails within a bounded time if the ready callback never arrives", async () => {
    vi.useFakeTimers();
    const { loadYouTubeApi } = await import("./youtube-api");
    const failure = expect(loadYouTubeApi()).rejects.toThrow(/暂时无法加载/);
    await vi.advanceTimersByTimeAsync(12_000);
    await failure;
    expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();
  });
});
