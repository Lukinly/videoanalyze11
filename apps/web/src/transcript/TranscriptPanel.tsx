import { useState } from "react";
import type { TranscriptSegment } from "@videoanalyze/domain";

type TranscriptPanelProps = {
  segments: TranscriptSegment[];
  onSeek: (seconds: number) => void;
  activeSegmentId?: string;
};

export function formatTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const formatted = [minutes, remainder].map((value) => String(value).padStart(2, "0"));
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${formatted.join(":")}` : formatted.join(":");
}

export function TranscriptPanel({ segments, onSeek, activeSegmentId }: TranscriptPanelProps) {
  return (
    <section className="transcript-panel" aria-labelledby="transcript-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">V0 transcript</p>
          <h2 id="transcript-heading">逐字稿</h2>
        </div>
        <span className="count-badge">{segments.length} 段</span>
      </div>
      {segments.length === 0 ? (
        <p className="empty-state">分析完成后，带时间戳的逐字稿会出现在这里。</p>
      ) : segments.length > 500 ? (
        <VirtualTranscriptList segments={segments} onSeek={onSeek} activeSegmentId={activeSegmentId} />
      ) : (
        <ol className="transcript-list">
          {segments.map((segment) => <TranscriptItem key={segment.id} segment={segment} onSeek={onSeek} active={segment.id === activeSegmentId} />)}
        </ol>
      )}
    </section>
  );
}

function TranscriptItem({ segment, onSeek, active }: { segment: TranscriptSegment; onSeek: (seconds: number) => void; active: boolean }) {
  return (
    <li data-follow-id={segment.id}>
      <button
        className={`transcript-item${active ? " is-active" : ""}`}
        type="button"
        aria-label={`${formatTimestamp(segment.start)} ${segment.text}`}
        onClick={() => onSeek(segment.start)}
      >
        <time dateTime={`PT${segment.start}S`}>{formatTimestamp(segment.start)}</time>
        <span>{segment.text}</span>
      </button>
    </li>
  );
}

function VirtualTranscriptList({ segments, onSeek, activeSegmentId }: TranscriptPanelProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 56;
  const viewportHeight = 480;
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const lastVisible = Math.min(segments.length, firstVisible + Math.ceil(viewportHeight / rowHeight) + 8);

  return (
    <div className="transcript-virtual" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <ol className="transcript-list" style={{ paddingTop: firstVisible * rowHeight, paddingBottom: Math.max(0, (segments.length - lastVisible) * rowHeight) }}>
        {segments.slice(firstVisible, lastVisible).map((segment) => <TranscriptItem key={segment.id} segment={segment} onSeek={onSeek} active={segment.id === activeSegmentId} />)}
      </ol>
    </div>
  );
}
