import { describe, expect, it } from "vitest";
import { aiNotesSchema, noteSectionTimeline } from "./ai-notes.js";

const notes = {
  title: "A detailed lesson",
  topic: "One-line topic",
  coreIdeas: ["First idea"],
  sections: [{ id: "intro", level: 1, title: "Introduction", body: "Detailed body", citations: [{ segmentId: "seg_1", timestampSeconds: 12 }] }],
  reviewPoints: ["Remember this"]
};

describe("AI notes contract", () => {
  it("accepts detailed headings with traceable timestamp citations", () => {
    expect(aiNotesSchema.parse(notes)).toEqual(notes);
  });

  it("rejects sections without source citations and invalid heading levels", () => {
    expect(() => aiNotesSchema.parse({ ...notes, sections: [{ ...notes.sections[0], citations: [] }] })).toThrow();
    expect(() => aiNotesSchema.parse({ ...notes, sections: [{ ...notes.sections[0], level: 4 }] })).toThrow();
  });

  it("uses all source segments to form one range and selects the middle cited moment", () => {
    const section = { ...notes.sections[0], level: 1 as const, citations: [
      { segmentId: "c", timestampSeconds: 48 }, { segmentId: "a", timestampSeconds: 6 },
      { segmentId: "b", timestampSeconds: 24 }
    ] };
    const segments = [{ id: "c", runId: "r", start: 48, end: 53, text: "end" }];
    expect(noteSectionTimeline(section, segments)).toEqual({ start: 6, end: 53, frameSeconds: 24 });
    expect(noteSectionTimeline(section)).toEqual({ start: 6, end: 48, frameSeconds: 24 });
  });

  it("preserves an optional real JPEG frame but rejects arbitrary image URLs", () => {
    const withFrame = (dataUrl: string) => ({ ...notes, sections: [{ ...notes.sections[0], frame: { timestampSeconds: 12, dataUrl } }] });
    expect(aiNotesSchema.parse(withFrame("data:image/jpeg;base64,/9j/2Q==")).sections[0].frame?.timestampSeconds).toBe(12);
    expect(() => aiNotesSchema.parse(withFrame("https://untrusted.example/image.jpg"))).toThrow();
  });
});
