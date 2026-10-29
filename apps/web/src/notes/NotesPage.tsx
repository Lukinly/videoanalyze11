import type { RefObject } from "react";
import type { AnalysisRun } from "../api/client";
import { Brand } from "../brand/Brand";
import { VideoPlayer, type PlayerController } from "../player/VideoPlayer";
import { exportNotesMarkdown, exportNotesText, formatTime, notesFileName } from "./export-notes";
import { noteSectionTimeline, parseVideoLink } from "@videoanalyze/domain";
import { useNoteFrames } from "./use-note-frames";
import { PlatformVideoPlayer } from "../player/PlatformVideoPlayer";

export function NotesPage({ run, playbackUrl, playerRef, onAttach }: { run: AnalysisRun; playbackUrl: string; playerRef: RefObject<PlayerController | null>; onAttach: (url: string, fileName: string) => void }) {
  const notes = run.notes;
  const remote = run.sourcePlatform === "youtube" || run.sourcePlatform === "bilibili";
  const frames = useNoteFrames(playbackUrl, notes?.sections, run.transcript?.segments);
  const canPlayRemote = remote && Boolean(parseVideoLink(run.sourceUrl ?? ""));
  const openAt = (seconds: number) => playerRef.current?.seek(seconds);
  return <main className="notes-shell">
    <header className="topbar notes-topbar"><Brand /><nav><a href={`/?run=${encodeURIComponent(run.id)}`}>返回视频</a></nav></header>
    <div className="notes-layout">
      <aside className="notes-player">
        {!playbackUrl && remote ? <PlatformVideoPlayer ref={playerRef} sourceUrl={run.sourceUrl} title={run.fileName} /> : <VideoPlayer ref={playerRef} src={playbackUrl} title={run.fileName} emptyLabel="选择本地原视频，按笔记时间段回看" />}
        {!playbackUrl && <><label className="secondary-button local-file-button">选择本地原视频<input className="visually-hidden" type="file" accept="video/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onAttach(URL.createObjectURL(file), file.name); }} /></label><p className="notes-player-hint">选择分析时的同一视频，即可补充片段画面并按时间回看。文件仅在本机读取。</p></>}
        <p className="notes-player-hint">点击笔记标题旁的时间范围，回看对应片段。</p>
      </aside>
      <article className="notes-document">
        {!notes ? <div className="notes-empty"><h1>AI 笔记尚不可用</h1><p>{run.resultAvailability === "expired" ? "隐私结果已到期。" : "分析完成后会在这里生成详细笔记。"}</p></div> : <>
          <header className="notes-heading"><p className="eyebrow">AI study notes</p><h1>{notes.title}</h1><p>{notes.topic}</p><div className="notes-export"><button type="button" onClick={() => download(notesFileName(notes.title, "md"), exportNotesMarkdown(notes), "text/markdown")}>导出 Markdown</button><button type="button" onClick={() => download(notesFileName(notes.title, "txt"), exportNotesText(notes), "text/plain")}>导出文本</button></div></header>
          <section className="notes-overview"><h2>核心观点</h2><ul>{notes.coreIdeas.map((idea) => <li key={idea}>{idea}</li>)}</ul></section>
          {frames.loading && <p className="notes-media-status" role="status">正在提取原视频画面…</p>}
          {frames.failed && <p className="notes-media-status" role="status">部分画面暂时无法读取，仍可通过时间范围回看原视频。</p>}
          {!playbackUrl && notes.sections.some((section) => !section.frame) && <p className="notes-media-status">这份笔记的部分片段尚未保存画面，可选择本地原视频补充。</p>}
          {notes.sections.map((section, index) => {
            const Heading = `h${section.level + 1}` as "h2" | "h3" | "h4";
            const { start, end, frameSeconds } = noteSectionTimeline(section, run.transcript?.segments);
            const frame = section.frame ?? (frames.frames[frameSeconds] ? { timestampSeconds: frameSeconds, dataUrl: frames.frames[frameSeconds] } : undefined);
            const range = end > start ? `${fullTime(start)} – ${fullTime(end)}` : fullTime(start);
            return <section className="notes-section" key={section.id}>
              <header className="note-section-heading"><div className="note-section-title"><span className="note-section-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><Heading>{section.title}</Heading></div><button className="note-time-range" type="button" disabled={!playbackUrl && !canPlayRemote} aria-label={`回看${section.title}，${range}`} title={!playbackUrl && !canPlayRemote ? "请先选择本地原视频" : "回看此片段"} onClick={() => openAt(start)}><span aria-hidden="true">▷</span> {range}</button></header>
              {frame && <figure className="note-frame"><img src={frame.dataUrl} alt={`${section.title}：原视频 ${fullTime(frame.timestampSeconds)} 的画面`} loading="lazy" /><figcaption>原视频画面 <span>· {fullTime(frame.timestampSeconds)}</span></figcaption></figure>}
              <p>{section.body}</p>
            </section>;
          })}
          <section className="notes-review"><h2>复习要点</h2><ul>{notes.reviewPoints.map((point) => <li key={point}>{point}</li>)}</ul></section>
        </>}
      </article>
    </div>
  </main>;
}

function fullTime(seconds: number) {
  const time = formatTime(seconds);
  return time.length === 5 ? `00:${time}` : time;
}

function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
