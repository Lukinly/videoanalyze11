import { noteFrameSchema, noteSectionTimeline, type AiNotes } from "@videoanalyze/domain";
import { AnalysisCancelledError } from "../analysis/cancellation.js";

// Bound both processing time and the JSON result size for long videos.
export const MAX_NOTE_FRAMES = 24;
const MAX_TOTAL_IMAGE_CHARACTERS = 4_000_000;

export async function addNoteFrames(notes: AiNotes, capture: (seconds: number) => Promise<string>, signal?: AbortSignal): Promise<AiNotes> {
  let imageCharacters = 0;
  let failures = 0;
  const sections: AiNotes["sections"] = [];
  const cache = new Map<number, string>();
  for (const [index, section] of notes.sections.entries()) {
    signal?.throwIfAborted();
    if (index >= MAX_NOTE_FRAMES || failures >= 2 || imageCharacters >= MAX_TOTAL_IMAGE_CHARACTERS) {
      sections.push(section);
      continue;
    }
    const timestampSeconds = noteSectionTimeline(section).frameSeconds;
    try {
      const dataUrl = cache.get(timestampSeconds) ?? await capture(timestampSeconds);
      const frame = noteFrameSchema.parse({ timestampSeconds, dataUrl });
      cache.set(timestampSeconds, dataUrl);
      if (imageCharacters + dataUrl.length > MAX_TOTAL_IMAGE_CHARACTERS) {
        sections.push(section);
        continue;
      }
      imageCharacters += dataUrl.length;
      sections.push({ ...section, frame });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof AnalysisCancelledError) throw error;
      failures += 1;
      // An unavailable video stream must not discard otherwise usable notes.
      sections.push(section);
    }
  }
  return { ...notes, sections };
}
