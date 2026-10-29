import { useEffect, useState } from "react";
import { noteSectionTimeline, type AiNotes, type TranscriptSegment } from "@videoanalyze/domain";
import { captureVideoFrames } from "./capture-video-frames";

const EMPTY_SECTIONS: AiNotes["sections"] = [];
const EMPTY_FRAMES: Record<number, string> = {};

export function useNoteFrames(src: string, sections: AiNotes["sections"] = EMPTY_SECTIONS, segments?: TranscriptSegment[]) {
  const [result, setResult] = useState<{ src: string; sections: AiNotes["sections"]; frames: Record<number, string>; loading: boolean; failed: boolean }>();
  useEffect(() => {
    const timestamps = sections.filter((section) => !section.frame).slice(0, 24).map((section) => noteSectionTimeline(section, segments).frameSeconds);
    if (!src || !timestamps.length) return;
    const controller = new AbortController();
    let frames: Record<number, string> = {};
    setResult({ src, sections, frames, loading: true, failed: false });
    void captureVideoFrames(src, timestamps, (seconds, dataUrl) => {
      if (controller.signal.aborted) return;
      frames = { ...frames, [seconds]: dataUrl };
      setResult({ src, sections, frames, loading: true, failed: false });
    }, controller.signal).then(() => {
      if (!controller.signal.aborted) setResult({ src, sections, frames, loading: false, failed: Object.keys(frames).length < new Set(timestamps).size });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ src, sections, frames, loading: false, failed: true });
    });
    return () => controller.abort();
  }, [src, sections, segments]);
  return result?.src === src && result.sections === sections ? result : { frames: EMPTY_FRAMES, loading: false, failed: false };
}
