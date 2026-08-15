import { describe, expect, it } from "vitest";
import { exportNotesMarkdown, exportNotesText, notesFileName } from "./export-notes";

const notes = {
  title: "深入 / TypeScript",
  topic: "类型系统",
  coreIdeas: ["类型是约束"],
  sections: [{ id: "s1", level: 2 as const, title: "结构类型", body: "按形状兼容。", citations: [{ segmentId: "seg-1", timestampSeconds: 65 }] }],
  reviewPoints: ["理解结构兼容"]
};

describe("AI notes exports", () => {
  it("renders headings and traceable timestamps as Markdown", () => {
    expect(exportNotesMarkdown(notes)).toContain("## 结构类型");
    expect(exportNotesMarkdown(notes)).toContain("[01:05]");
  });

  it("renders a readable plain text variant and safe filename", () => {
    expect(exportNotesText(notes)).toContain("结构类型\n按形状兼容。");
    expect(notesFileName(notes.title, "md")).toBe("深入-TypeScript-AI笔记.md");
  });
});
