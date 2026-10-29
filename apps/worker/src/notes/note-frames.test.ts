import { describe, expect, it, vi } from "vitest";
import type { AiNotes } from "@videoanalyze/domain";
import { addNoteFrames, MAX_NOTE_FRAMES } from "./note-frames.js";
import { AnalysisCancelledError } from "../analysis/cancellation.js";

const jpeg = "data:image/jpeg;base64,/9j/2Q==";
function notes(count = 1): AiNotes {
  return { title: "Lesson", topic: "Topic", coreIdeas: ["Idea"], reviewPoints: ["Review"], sections: Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, level: 1, title: `Section ${i}`, body: "Explanation", citations: [
      { segmentId: `${i}-a`, timestampSeconds: i * 100 + 6 },
      { segmentId: `${i}-b`, timestampSeconds: i * 100 + 24 },
      { segmentId: `${i}-c`, timestampSeconds: i * 100 + 48 }
    ]
  })) };
}

describe("note frames", () => {
  it("attaches a representative frame without changing the source citations", async () => {
    const capture = vi.fn().mockResolvedValue(jpeg);
    const original = notes();
    const result = await addNoteFrames(original, capture);
    expect(capture).toHaveBeenCalledWith(24);
    expect(result.sections[0].frame).toEqual({ timestampSeconds: 24, dataUrl: jpeg });
    expect(result.sections[0].citations).toEqual(original.sections[0].citations);
    expect(original.sections[0].frame).toBeUndefined();
  });

  it("retains readable notes when video access fails and stops repeated failures", async () => {
    const original = notes(5);
    const capture = vi.fn().mockRejectedValue(new Error("blocked"));
    expect(await addNoteFrames(original, capture)).toEqual(original);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("limits images on long videos and never swallows cancellation", async () => {
    const capture = vi.fn().mockResolvedValue(jpeg);
    const result = await addNoteFrames(notes(30), capture);
    expect(capture).toHaveBeenCalledTimes(MAX_NOTE_FRAMES);
    expect(result.sections).toHaveLength(30);
    const controller = new AbortController();
    capture.mockImplementation(async () => { controller.abort(); throw new Error("aborted"); });
    await expect(addNoteFrames(notes(), capture, controller.signal)).rejects.toThrow();
    capture.mockRejectedValue(new AnalysisCancelledError("after_processing"));
    await expect(addNoteFrames(notes(), capture)).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});
