import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisRun } from "../api/client";
import { ViewingSidebar } from "./ViewingSidebar";

const run: AnalysisRun = {
  id: "run-1",
  videoId: "video-1",
  status: "completed",
  stage: "completed",
  transcript: {
    mergeWarnings: [],
    segments: [
      { id: "s1", runId: "run-1", start: 10, end: 20, text: "当前讲解内容" }
    ]
  },
  summary: {
    oneLineSummary: "一句话摘要",
    overallSummary: "整体摘要内容",
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        start: 0,
        end: 20,
        summary: "章节摘要",
        sourceSegmentIds: ["s1"],
        bullets: [{ text: "章节要点", sourceSegmentIds: ["s1"] }]
      }
    ]
  }
};

describe("ViewingSidebar", () => {
  it("shows chapter notes by default and switches to the active transcript", async () => {
    const user = userEvent.setup();
    const seek = vi.fn();
    render(<ViewingSidebar run={run} currentTime={12} onSeek={seek} />);

    expect(screen.getByRole("tab", { name: "章节笔记", selected: true })).toBeVisible();
    expect(screen.getByText("章节要点")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "逐字稿" }));

    const segment = screen.getByRole("button", { name: "00:10 当前讲解内容" });
    expect(segment).toHaveClass("is-active");
    await user.click(segment);
    expect(seek).toHaveBeenCalledWith(10);
  });
});
