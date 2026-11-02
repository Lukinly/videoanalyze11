import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAnalysis = vi.hoisted(() => vi.fn());
const subscribeToAnalysis = vi.hoisted(() => vi.fn<(runId: string, onProgress: (event: { stage: string; status?: string }) => void, onError?: () => void) => () => void>(() => () => undefined));

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

  it.each(["failed", "cancelled"])("notifies the workspace once and stops polling when the persisted run is %s", async (status) => {
    vi.useFakeTimers();
    const terminal = { id: "run_1", videoId: "video_1", status, stage: "transcribing", progress: 0.2 };
    getAnalysis.mockResolvedValueOnce({ ...terminal, status: "running" }).mockResolvedValue(terminal);
    const onTerminal = vi.fn();
    const onCompleted = vi.fn();
    const close = vi.fn();
    subscribeToAnalysis.mockReturnValueOnce(close);
    const { AnalysisProgress } = await import("./AnalysisProgress");
    const view = render(<AnalysisProgress runId="run_1" onCompleted={onCompleted} onTerminal={onTerminal} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onTerminal).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByText("任务已停止")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(getAnalysis).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});

it("loads full results once on completion and keeps one stream across callback changes", async () => {
  vi.useFakeTimers();
  const initial = { id: "run_1", videoId: "video_1", status: "queued", stage: "queued", progress: 0 };
  const complete = { ...initial, status: "completed", stage: "completed", progress: 1, notes: { sections: [{ title: "Full notes" }] } };
  getAnalysis.mockResolvedValueOnce(initial).mockResolvedValue(complete);
  const onCompleted = vi.fn();
  const close = vi.fn();
  subscribeToAnalysis.mockReturnValueOnce(close);
  const { AnalysisProgress } = await import("./AnalysisProgress");
  const view = render(<AnalysisProgress runId="run_1" onCompleted={onCompleted} />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { subscribeToAnalysis.mock.calls[0][1]({ stage: "completed", status: "completed" }); });
  expect(onCompleted).toHaveBeenCalledExactlyOnceWith(complete);
  expect(close).toHaveBeenCalled();
  view.rerender(<AnalysisProgress runId="run_1" onCompleted={vi.fn()} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(subscribeToAnalysis).toHaveBeenCalledTimes(1);
  expect(getAnalysis).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
