import { aiNotesSchema, type AiNotes, type AiNotesProvider, type TranscriptSegment } from "@videoanalyze/domain";
import { requireStageUpdate } from "../analysis/stage-fence.js";
import { estimateTranscriptTokens } from "../summary/token-budget.js";
import { createSummaryWindows } from "../summary/windowing.js";
import { addNoteFrames } from "./note-frames.js";

type NotesState = {
  getTranscript(runId: string): Promise<{ duration: number; segments: TranscriptSegment[] }>;
  setStage(runId: string, stage: string, progress?: number): Promise<boolean>;
  saveNotes(runId: string, notes: AiNotes): Promise<void>;
};

export function createNotesRunner(dependencies: { notes: AiNotesProvider; state: NotesState; captureFrame?: (seconds: number) => Promise<string> }) {
  return {
    async run(input: { runId: string; signal?: AbortSignal }): Promise<AiNotes> {
      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "generating_notes", 0.1));
      const transcript = await dependencies.state.getTranscript(input.runId);
      const realByCompact = new Map<string, TranscriptSegment>();
      const compactSegments = transcript.segments.map((segment, index) => {
        const id = `seg_${index + 1}`;
        realByCompact.set(id, segment);
        return { ...segment, id };
      });
      const capabilities = await dependencies.notes.capabilities();
      const inputBudget = Math.max(1, Math.floor(capabilities.contextWindow * 0.6));
      const generated = estimateTranscriptTokens(compactSegments) > inputBudget
        ? await mapReduceNotes(dependencies.notes, transcript.duration, compactSegments)
        : await dependencies.notes.generateNotes({ videoDuration: transcript.duration, segments: compactSegments });
      const normalized = normalizeNotes(generated, (id) => {
        const real = realByCompact.get(id);
        return real ? [{ segmentId: real.id, timestampSeconds: real.start }] : [];
      });
      const notes = dependencies.captureFrame ? await addNoteFrames(normalized, dependencies.captureFrame, input.signal) : normalized;
      input.signal?.throwIfAborted();
      await dependencies.state.saveNotes(input.runId, notes);
      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "indexing", 0.98));
      return notes;
    }
  };
}

async function mapReduceNotes(provider: AiNotesProvider, duration: number, segments: TranscriptSegment[]): Promise<AiNotes> {
  const capabilities = await provider.capabilities();
  const windows = createSummaryWindows(segments, capabilities.contextWindow);
  const mapped = await Promise.all(windows.map((window) => provider.generateNotes({ videoDuration: duration, segments: window.segments })));
  const sources = new Map<string, string[]>();
  const reductionSegments = mapped.flatMap((notes, notesIndex) => notes.sections.map((section, sectionIndex) => {
    const id = `map-${notesIndex}-${sectionIndex}`;
    sources.set(id, section.citations.map((citation) => citation.segmentId));
    return { id, runId: segments[0]?.runId ?? "notes", start: 0, end: duration, text: `${section.title}\n${section.body}` };
  }));
  if (reductionSegments.length === 0) throw new Error("AI notes map step produced no sections");
  const reduced = await provider.generateNotes({ videoDuration: duration, segments: reductionSegments });
  return normalizeNotes(reduced, (id) => (sources.get(id) ?? []).map((segmentId) => ({ segmentId, timestampSeconds: 0 })));
}

function normalizeNotes(notes: AiNotes, resolveCitation: (id: string) => Array<{ segmentId: string; timestampSeconds: number }>): AiNotes {
  const parsed = aiNotesSchema.parse(notes);
  const seen = new Set<string>();
  const sections = parsed.sections.flatMap((section) => {
    const citations = uniqueCitations(section.citations.flatMap((citation) => resolveCitation(citation.segmentId)));
    if (citations.length === 0) throw new Error(`AI notes citation is not traceable: ${section.id}`);
    const key = `${section.title.trim().toLocaleLowerCase()}\u0000${section.body.trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    // Only the media processor may supply images; discard model-supplied frames.
    return [{ id: section.id, level: section.level, title: section.title, body: section.body, citations }];
  });
  if (sections.length === 0) throw new Error("AI notes contain no traceable sections");
  return { ...parsed, sections };
}

function uniqueCitations(citations: Array<{ segmentId: string; timestampSeconds: number }>) {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.segmentId)) return false;
    seen.add(citation.segmentId);
    return true;
  });
}
