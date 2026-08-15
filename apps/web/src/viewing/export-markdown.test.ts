import { describe, expect, it } from "vitest";
import { exportAnalysisMarkdown } from "./export-markdown";

describe("analysis markdown export", () => {
  it("exports summaries, timestamped chapters, and transcript text", () => {
    const markdown = exportAnalysisMarkdown({
      fileName: "demo.mp4",
      summary: { oneLineSummary: "一句话", overallSummary: "整体", chapters: [{ id: "c1", title: "开场", start: 65, end: 90, summary: "简介", bullets: [{ text: "要点", sourceSegmentIds: [] }], sourceSegmentIds: [] }] },
      transcript: { mergeWarnings: [], segments: [{ id: "s1", runId: "r1", start: 2, end: 5, text: "你好" }] }
    });
    expect(markdown).toContain("# demo.mp4");
    expect(markdown).toContain("## 开场 · 01:05");
    expect(markdown).toContain("- 00:02 你好");
  });
});
