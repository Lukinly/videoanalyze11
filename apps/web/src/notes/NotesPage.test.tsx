import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlayerController } from "../player/VideoPlayer";
import { NotesPage } from "./NotesPage";
import type { AnalysisRun } from "../api/client";
import { captureVideoFrames } from "./capture-video-frames";

vi.mock("./capture-video-frames", () => ({ captureVideoFrames: vi.fn().mockResolvedValue(undefined) }));

function fixture(): AnalysisRun {
  return { id: "r1", videoId: "v1", fileName: "lesson.mp4", status: "completed", stage: "completed", transcript: { mergeWarnings: [], segments: [
    { id: "last", runId: "r1", start: 48, end: 53, text: "结尾" }
  ] }, notes: { title: "课程笔记", topic: "主题", coreIdeas: ["观点"], sections: [{ id: "s1", level: 1, title: "概念", body: "详细解释", citations: [
    { segmentId: "last", timestampSeconds: 48 }, { segmentId: "first", timestampSeconds: 6 }, { segmentId: "middle", timestampSeconds: 24 }
  ], frame: { timestampSeconds: 24, dataUrl: "data:image/jpeg;base64,/9j/2Q==" } }], reviewPoints: ["复习"] } };
}

describe("NotesPage", () => {
  it("shows detailed notes and seeks from a citation", async () => {
    const playerRef = createRef<PlayerController>();
    playerRef.current = { seek: vi.fn(), enableSound: vi.fn(), getCurrentTime: vi.fn(() => 0), getPaused: vi.fn(() => true) };
    render(<NotesPage run={{ id: "r1", videoId: "v1", fileName: "lesson.mp4", status: "completed", stage: "completed", notes: { title: "课程笔记", topic: "主题", coreIdeas: ["观点"], sections: [{ id: "s1", level: 1, title: "概念", body: "详细解释", citations: [{ segmentId: "seg", timestampSeconds: 75 }] }], reviewPoints: ["复习"] } }} playbackUrl="blob:video" playerRef={playerRef} onAttach={vi.fn()} />);

    const seek = vi.fn();
    playerRef.current.seek = seek;
    expect(screen.getByRole("heading", { name: "课程笔记" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /01:15/ }));
    expect(seek).toHaveBeenCalledWith(75);
    await waitFor(() => expect(screen.queryByText("正在提取原视频画面…")).not.toBeInTheDocument());
  });

  it("replaces a dense citation list with one range, a real frame, and the original body", () => {
    const playerRef = createRef<PlayerController>();
    render(<NotesPage run={fixture()} playbackUrl="blob:video" playerRef={playerRef} onAttach={vi.fn()} />);
    const seek = vi.fn();
    playerRef.current!.seek = seek;
    const ranges = screen.getAllByRole("button", { name: /^回看/ });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toHaveTextContent("00:00:06 – 00:00:53");
    expect(screen.getByRole("img", { name: "概念：原视频 00:00:24 的画面" })).toHaveAttribute("src", "data:image/jpeg;base64,/9j/2Q==");
    expect(screen.getByText("详细解释")).toBeInTheDocument();
    fireEvent.click(ranges[0]);
    expect(seek).toHaveBeenCalledWith(6);
  });

  it("seeks the embedded source player without opening another window", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const run = { ...fixture(), sourcePlatform: "bilibili" as const, sourceUrl: "https://www.bilibili.com/video/BV1AB411c7mD?p=3" };
    render(<NotesPage run={run} playbackUrl="" playerRef={createRef<PlayerController>()} onAttach={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^回看/ }));
    const frame = screen.getByTitle("lesson.mp4（B站官方播放器）");
    expect(frame).toHaveAttribute("src", expect.stringContaining("t=6"));
    expect(frame).toHaveAttribute("src", expect.stringContaining("p=3"));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", expect.stringContaining("t=6"));
    open.mockRestore();
  });

  it("allows reading saved frames after original deletion and explains how to reattach", () => {
    render(<NotesPage run={fixture()} playbackUrl="" playerRef={createRef<PlayerController>()} onAttach={vi.fn()} />);
    expect(screen.getByRole("img", { name: /原视频 00:00:24 的画面/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^回看/ })).toBeDisabled();
    expect(screen.getByText("选择本地原视频")).toBeInTheDocument();
  });

  it("extracts missing frames from an attached file and cancels extraction on unmount", async () => {
    const run = fixture();
    delete run.notes!.sections[0].frame;
    vi.mocked(captureVideoFrames).mockImplementationOnce(async (_src, timestamps, onFrame) => { onFrame(timestamps[0], "data:image/jpeg;base64,/9j/2Q=="); });
    const { unmount } = render(<NotesPage run={run} playbackUrl="blob:attached" playerRef={createRef<PlayerController>()} onAttach={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("img", { name: /原视频 00:00:24 的画面/ })).toBeInTheDocument());
    const signal = vi.mocked(captureVideoFrames).mock.calls.at(-1)![3];
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
