import { formatTimestamp } from "../transcript/TranscriptPanel";

export type Chapter = {
  id: string;
  title: string;
  start: number;
  end: number;
  summary?: string;
  alignmentWarning?: boolean;
  bullets?: Array<{ text: string; sourceSegmentIds: string[] }>;
};

export function ChapterList({ chapters, onSeek, activeChapterId }: { chapters: Chapter[]; onSeek: (seconds: number) => void; activeChapterId?: string }) {
  return <section className="chapter-panel" aria-labelledby="chapter-heading">
    <div className="section-heading"><div><p className="eyebrow">Navigate</p><h2 id="chapter-heading">章节</h2></div><span className="count-badge">{chapters.length}</span></div>
    {chapters.length === 0 ? <p className="empty-state">摘要完成后会生成可跳转章节。</p> : <ol className="chapter-list">{chapters.map((chapter) => <li data-follow-id={chapter.id} key={chapter.id}><button className={chapter.id === activeChapterId ? "is-active" : undefined} type="button" onClick={() => onSeek(chapter.start)}><span className="chapter-time">{formatTimestamp(chapter.start)}</span><span><strong>{chapter.title}</strong>{chapter.summary && <small>{chapter.summary}</small>}{chapter.bullets && chapter.bullets.length > 0 && <ul className="chapter-bullets">{chapter.bullets.map((bullet, index) => <li key={`${chapter.id}-bullet-${index}`}>{bullet.text}</li>)}</ul>}</span></button></li>)}</ol>}
  </section>;
}
