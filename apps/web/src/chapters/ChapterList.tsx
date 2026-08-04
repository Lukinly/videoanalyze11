import { formatTimestamp } from "../transcript/TranscriptPanel";

export type Chapter = { id: string; title: string; start: number; end: number; summary?: string; alignmentWarning?: boolean };

export function ChapterList({ chapters, onSeek }: { chapters: Chapter[]; onSeek: (seconds: number) => void }) {
  return <section className="chapter-panel" aria-labelledby="chapter-heading">
    <div className="section-heading"><div><p className="eyebrow">Navigate</p><h2 id="chapter-heading">章节</h2></div><span className="count-badge">{chapters.length}</span></div>
    {chapters.length === 0 ? <p className="empty-state">摘要完成后会生成可跳转章节。</p> : <ol className="chapter-list">{chapters.map((chapter) => <li key={chapter.id}><button type="button" onClick={() => onSeek(chapter.start)}><span className="chapter-time">{formatTimestamp(chapter.start)}</span><span><strong>{chapter.title}</strong>{chapter.summary && <small>{chapter.summary}</small>}</span></button></li>)}</ol>}
  </section>;
}
