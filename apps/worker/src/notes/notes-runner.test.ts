import { describe, expect, it, vi } from "vitest";
import { createNotesRunner } from "./notes-runner.js";

const transcript = {
  duration: 120,
  segments: [
    { id: "run_seg_1", runId: "run", start: 12, end: 20, text: "first detailed point" },
    { id: "run_seg_2", runId: "run", start: 70, end: 80, text: "second detailed point" }
  ]
};

describe("detailed notes runner", () => {
  it("generates single-pass notes and replaces model timestamps with real transcript times", async () => {
    const notes = providerDouble(10_000);
    const state = stateDouble();
    await createNotesRunner({ notes, state }).run({ runId: "run" });

    expect(state.saveNotes).toHaveBeenCalledWith("run", expect.objectContaining({
      sections: [expect.objectContaining({ citations: [{ segmentId: "run_seg_1", timestampSeconds: 12 }] })]
    }));
    expect(state.setStage).toHaveBeenCalledWith("run", "generating_notes", 0.1);
  });

  it("uses map-reduce for long transcripts and expands reduced citations without duplicate sections", async () => {
    const notes = providerDouble(20);
    notes.generateNotes
      .mockResolvedValueOnce(noteResult("Window one", "seg_1"))
      .mockResolvedValueOnce(noteResult("Window two", "seg_2"))
      .mockResolvedValueOnce({ ...noteResult("Global", "map-0-0"), sections: [
        noteResult("Global", "map-0-0").sections[0],
        noteResult("Global", "map-0-0").sections[0]
      ] });
    const state = stateDouble();

    const result = await createNotesRunner({ notes, state }).run({ runId: "run" });

    expect(notes.generateNotes.mock.calls.length).toBeGreaterThan(1);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].citations).toEqual([{ segmentId: "run_seg_1", timestampSeconds: 12 }]);
  });

  it("rejects invented citations instead of persisting untraceable notes", async () => {
    const notes = providerDouble(10_000);
    notes.generateNotes.mockResolvedValue(noteResult("Invented", "missing"));
    const state = stateDouble();

    await expect(createNotesRunner({ notes, state }).run({ runId: "run" })).rejects.toThrow(/citation/i);
    expect(state.saveNotes).not.toHaveBeenCalled();
  });
});

function noteResult(title: string, segmentId: string) {
  return {
    title: "Detailed notes", topic: "Topic", coreIdeas: ["Idea"], reviewPoints: ["Review"],
    sections: [{ id: title.toLowerCase().replaceAll(" ", "-"), level: 1 as const, title, body: "Detailed body", citations: [{ segmentId, timestampSeconds: 999 }] }]
  };
}

function providerDouble(contextWindow: number) {
  return {
    capabilities: vi.fn().mockResolvedValue({ contextWindow, structuredOutput: true }),
    generateNotes: vi.fn().mockResolvedValue(noteResult("Single", "seg_1"))
  };
}

function stateDouble() {
  return {
    getTranscript: vi.fn().mockResolvedValue(transcript),
    setStage: vi.fn().mockResolvedValue(true),
    saveNotes: vi.fn().mockResolvedValue(undefined)
  };
}
