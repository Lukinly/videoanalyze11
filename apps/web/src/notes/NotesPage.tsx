import type { RefObject } from "react";
import type { AnalysisRun } from "../api/client";
import { Brand } from "../brand/Brand";
import { VideoPlayer, type PlayerController } from "../player/VideoPlayer";
import { exportNotesMarkdown, exportNotesText, formatTime, notesFileName } from "./export-notes";
import { timestampedVideoUrl } from "@videoanalyze/domain";

export function NotesPage({ run, playbackUrl, playerRef, onAttach }: { run: AnalysisRun; playbackUrl: string; playerRef: RefObject<PlayerController | null>; onAttach: (url: string, fileName: string) => void }) {
  const notes = run.notes;
  const remote = run.sourcePlatform === "youtube" || run.sourcePlatform === "bilibili";
  const openAt = (seconds: number) => remote && run.sourceUrl ? window.open(timestampedVideoUrl(run.sourceUrl, seconds), "_blank", "noopener,noreferrer") : playerRef.current?.seek(seconds);
  return <main className="notes-shell">
    <header className="topbar notes-topbar"><Brand /><nav><a href={`/?run=${encodeURIComponent(run.id)}`}>返回视频</a></nav></header>
    <div className="notes-layout">
      <aside className="notes-player">
        {remote ? <div className="external-source-card compact">{run.thumbnailUrl && <img src={run.thumbnailUrl} alt="" />}<a className="primary-button" href={run.sourceUrl ?? "#"} target="_blank" rel="noreferrer">原视频</a></div> : <><VideoPlayer ref={playerRef} src={playbackUrl} title={run.fileName} emptyLabel="原视频已删除，可选择本地原视频后按时间点回看" />{!playbackUrl && <label className="secondary-button local-file-button">选择本地原视频<input className="visually-hidden" type="file" accept="video/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onAttach(URL.createObjectURL(file), file.name); }} /></label>}</>}
      </aside>
      <article className="notes-document">
        {!notes ? <div className="notes-empty"><h1>AI 笔记尚不可用</h1><p>{run.resultAvailability === "expired" ? "隐私结果已到期。" : "分析完成后会在这里生成详细笔记。"}</p></div> : <>
          <header className="notes-heading"><p className="eyebrow">AI study notes</p><h1>{notes.title}</h1><p>{notes.topic}</p><div className="notes-export"><button type="button" onClick={() => download(notesFileName(notes.title, "md"), exportNotesMarkdown(notes), "text/markdown")}>导出 Markdown</button><button type="button" onClick={() => download(notesFileName(notes.title, "txt"), exportNotesText(notes), "text/plain")}>导出文本</button></div></header>
          <section className="notes-overview"><h2>核心观点</h2><ul>{notes.coreIdeas.map((idea) => <li key={idea}>{idea}</li>)}</ul></section>
          {notes.sections.map((section) => {
            const Heading = `h${section.level + 1}` as "h2" | "h3" | "h4";
            return <section className="notes-section" key={section.id}><Heading>{section.title}</Heading><p>{section.body}</p><div className="note-citations">{section.citations.map((citation) => <button type="button" key={`${citation.segmentId}-${citation.timestampSeconds}`} aria-label={`跳转到 ${formatTime(citation.timestampSeconds)}`} onClick={() => openAt(citation.timestampSeconds)}>↗ {formatTime(citation.timestampSeconds)}</button>)}</div></section>;
          })}
          <section className="notes-review"><h2>复习要点</h2><ul>{notes.reviewPoints.map((point) => <li key={point}>{point}</li>)}</ul></section>
        </>}
      </article>
    </div>
  </main>;
}

function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
