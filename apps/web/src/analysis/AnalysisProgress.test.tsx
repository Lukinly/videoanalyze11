import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAnalysis = vi.hoisted(() => vi.fn());
const subscribeToAnalysis = vi.hoisted(() => vi.fn(() => () => undefined));

vi.mock("../api/client", () => ({
  api: { getAnalysis },
  subscribeToAnalysis
}));

describe("AnalysisProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("polls the persisted run so a worker update appears without an in-process SSE event", async () => {
    vi.useFakeTimers();
    getAnalysis
      .mockResolvedValueOnce({ id: "run_1", videoId: "video_1", status: "queued", stage: "queued", progress: 0 })
      .mockResolvedValue({ id: "run_1", videoId: "video_1", status: "running", stage: "transcribing", progress: 0.2, completedChunks: 0, totalChunks: 1 });

    const { AnalysisProgress } = await import("./AnalysisProgress");
    render(<AnalysisProgress runId="run_1" />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("排队中")).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(getAnalysis).toHaveBeenCalledTimes(2);
    expect(screen.getByText("处理中")).toBeVisible();
    expect(screen.getByText("0 / 1 音频块")).toBeVisible();
  });
});
