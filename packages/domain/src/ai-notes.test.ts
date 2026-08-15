import { describe, expect, it } from "vitest";
import { aiNotesSchema } from "./ai-notes.js";

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
});
