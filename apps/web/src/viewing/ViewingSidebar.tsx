import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisRun } from "../api/client";
import { ChapterList, type Chapter } from "../chapters/ChapterList";
import { SearchPanel } from "../search/SearchPanel";
import { SummaryPanel } from "../summary/SummaryPanel";
import { TranscriptPanel } from "../transcript/TranscriptPanel";
import { findActiveTimedItem, FOLLOW_RESUME_DELAY_MS } from "./playback-follow";

type ViewingSidebarProps = {
  run: AnalysisRun | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
};

export function ViewingSidebar({ run, currentTime, onSeek }: ViewingSidebarProps) {
  const [tab, setTab] = useState<"chapters" | "transcript">("chapters");
  const viewportRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chapters = useMemo<Chapter[]>(() => (run?.summary?.chapters ?? []).flatMap((chapter) => (
    chapter.start === undefined || chapter.end === undefined
      ? []
      : [{
          id: chapter.id,
          title: chapter.title,
          start: chapter.start,
          end: chapter.end,
          summary: chapter.summary,
          bullets: chapter.bullets,
          alignmentWarning: chapter.alignmentWarning
        }]
  )), [run?.summary?.chapters]);
  const segments = run?.transcript?.segments ?? [];
  const activeChapterId = findActiveTimedItem(chapters, currentTime)?.id;
  const activeSegmentId = findActiveTimedItem(segments, currentTime)?.id;
  const activeFollowId = tab === "chapters" ? activeChapterId : activeSegmentId;

  useEffect(() => () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!followingRef.current || !activeFollowId) return;
    const target = Array.from(viewportRef.current?.querySelectorAll<HTMLElement>("[data-follow-id]") ?? [])
      .find((element) => element.dataset.followId === activeFollowId);
    target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeFollowId, tab]);

  function pauseFollow() {
    followingRef.current = false;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      followingRef.current = true;
    }, FOLLOW_RESUME_DELAY_MS);
  }

  return (
    <aside className="viewing-sidebar" aria-label="视频内容导航">
      <div className="viewing-tabs" role="tablist" aria-label="视频内容">
        <button aria-selected={tab === "chapters"} className={tab === "chapters" ? "is-active" : undefined} role="tab" type="button" onClick={() => setTab("chapters")}>章节笔记</button>
        <button aria-selected={tab === "transcript"} className={tab === "transcript" ? "is-active" : undefined} role="tab" type="button" onClick={() => setTab("transcript")}>逐字稿</button>
      </div>
      <SearchPanel runId={run?.id} onSeek={onSeek} />
      <div className="viewing-scroll" ref={viewportRef} onScroll={pauseFollow}>
        {tab === "chapters" ? <>
          <SummaryPanel oneLineSummary={run?.summary?.oneLineSummary} overallSummary={run?.summary?.overallSummary} />
          <ChapterList chapters={chapters} activeChapterId={activeChapterId} onSeek={onSeek} />
        </> : <TranscriptPanel segments={segments} activeSegmentId={activeSegmentId} onSeek={onSeek} />}
      </div>
    </aside>
  );
}
