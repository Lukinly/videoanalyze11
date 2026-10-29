import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformVideoPlayer } from "./PlatformVideoPlayer";
import { loadYouTubeApi, type YouTubeApi } from "./youtube-api";
import type { PlayerController } from "./VideoPlayer";

vi.mock("./youtube-api", () => ({ loadYouTubeApi: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.mocked(loadYouTubeApi).mockReset(); });

describe("official platform players", () => {
  it("keeps the chosen Bilibili part and seeks inside the page, including repeated seeks", () => {
    const ref = createRef<PlayerController>();
    const onTimeUpdate = vi.fn();
    render(<PlatformVideoPlayer ref={ref} sourceUrl="https://www.bilibili.com/video/BV1AB411c7mD?p=3" title="讲座" onTimeUpdate={onTimeUpdate} />);
    const first = screen.getByTitle("讲座（B站官方播放器）");
    expect(first).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(new URL(first.getAttribute("src")!).searchParams.get("autoplay")).toBe("0");
    act(() => ref.current!.seek(75));
    const next = screen.getByTitle("讲座（B站官方播放器）");
    const url = new URL(next.getAttribute("src")!);
    expect(url.origin).toBe("https://player.bilibili.com");
    expect(url.searchParams.get("p")).toBe("3");
    expect(url.searchParams.get("t")).toBe("75");
    expect(onTimeUpdate).toHaveBeenCalledWith(75);
    expect(screen.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", "https://www.bilibili.com/video/BV1AB411c7mD?p=3&t=75");
    act(() => ref.current!.seek(75));
    expect(screen.getByTitle("讲座（B站官方播放器）")).not.toBe(next);
  });

  it("clears the Bilibili load timeout after the iframe has loaded", () => {
    vi.useFakeTimers();
    render(<PlatformVideoPlayer sourceUrl="https://www.bilibili.com/video/BV1AB411c7mD" title="讲座" />);
    fireEvent.load(screen.getByTitle("讲座（B站官方播放器）"));
    act(() => vi.advanceTimersByTime(16_000));
    expect(screen.queryByText(/加载较慢/)).not.toBeInTheDocument();
  });

  it("keeps a slow Bilibili iframe accessible instead of covering its own controls", () => {
    vi.useFakeTimers();
    const { container } = render(<PlatformVideoPlayer sourceUrl="https://www.bilibili.com/video/BV1AB411c7mD" title="讲座" />);
    act(() => vi.advanceTimersByTime(16_000));
    expect(screen.getByRole("status")).toHaveTextContent("加载较慢");
    expect(screen.getByTitle("讲座（B站官方播放器）")).toBeVisible();
    expect(container.querySelector(".platform-player-status")).toBeNull();
  });

  it("queues YouTube seeks until ready, reports actual progress, and destroys the player on unmount", async () => {
    vi.useFakeTimers();
    const mock = youtubeDouble();
    vi.mocked(loadYouTubeApi).mockResolvedValue(mock.api);
    const ref = createRef<PlayerController>();
    const onTimeUpdate = vi.fn();
    const { unmount } = render(<PlatformVideoPlayer ref={ref} sourceUrl="https://youtu.be/abcdefghijk" title="Lecture" onTimeUpdate={onTimeUpdate} />);
    act(() => ref.current!.seek(90));
    await act(async () => {});
    expect(mock.player.seekTo).not.toHaveBeenCalled();
    act(() => mock.ready());
    expect(mock.player.seekTo).toHaveBeenCalledWith(90, true);
    act(() => vi.advanceTimersByTime(500));
    expect(onTimeUpdate).toHaveBeenCalledWith(92);
    expect(screen.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", expect.stringContaining("t=92s"));
    const iframe = screen.getByTitle("Lecture（YouTube 官方播放器）");
    expect(iframe).toHaveAttribute("allowfullscreen");
    act(() => ref.current!.seek(123));
    expect(mock.player.seekTo).toHaveBeenLastCalledWith(123, true);
    unmount();
    expect(mock.player.destroy).toHaveBeenCalledOnce();
    const calls = onTimeUpdate.mock.calls.length;
    act(() => vi.advanceTimersByTime(1_000));
    expect(onTimeUpdate).toHaveBeenCalledTimes(calls);
  });

  it("keeps the original-video link when YouTube disallows embedding or the API fails", async () => {
    const mock = youtubeDouble();
    vi.mocked(loadYouTubeApi).mockResolvedValue(mock.api);
    const { unmount } = render(<PlatformVideoPlayer sourceUrl="https://youtu.be/abcdefghijk" />);
    await waitFor(() => expect(mock.started()).toBe(true));
    act(() => mock.error(101));
    expect(screen.getByRole("status")).toHaveTextContent("该视频不允许站外播放");
    expect(screen.getByRole("link", { name: /打开原视频/ })).toBeVisible();
    unmount();
    vi.mocked(loadYouTubeApi).mockRejectedValue(new Error("blocked"));
    render(<PlatformVideoPlayer sourceUrl="https://youtu.be/abcdefghijk" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂时无法加载"));
    expect(screen.getByRole("link", { name: /打开原视频/ })).toBeVisible();
  });

  it("rejects untrusted embed addresses", () => {
    const { container } = render(<PlatformVideoPlayer sourceUrl="javascript:alert(1)" />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/无法识别原视频链接/)).toBeVisible();
  });

  it("does not create a player if its shared API finishes loading after unmount", async () => {
    let resolveApi!: (api: YouTubeApi) => void;
    vi.mocked(loadYouTubeApi).mockImplementation(() => new Promise((resolve) => { resolveApi = resolve; }));
    const mock = youtubeDouble();
    const { unmount } = render(<PlatformVideoPlayer sourceUrl="https://youtu.be/abcdefghijk" />);
    unmount();
    await act(async () => resolveApi(mock.api));
    expect(mock.started()).toBe(false);
  });
});

function youtubeDouble() {
  let events: ConstructorParameters<YouTubeApi["Player"]>[1]["events"] | undefined;
  const iframe = document.createElement("iframe");
  const player = { seekTo: vi.fn(), unMute: vi.fn(), setVolume: vi.fn(), getCurrentTime: vi.fn(() => 92), getPlayerState: vi.fn(() => 1), getIframe: () => iframe, destroy: vi.fn(() => iframe.remove()) };
  const api: YouTubeApi = { Player: function (element: HTMLElement, options: ConstructorParameters<YouTubeApi["Player"]>[1]) {
    events = options.events;
    element.replaceWith(iframe);
    return player;
  } as unknown as YouTubeApi["Player"] };
  return { api, player, started: () => Boolean(events), ready: () => events!.onReady({ target: player }), error: (data: number) => events!.onError({ data }) };
}
