import { useEffect, useState, type RefObject } from "react";
import type { AnalysisRun, CreditBalance, PublicUser } from "../api/client";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { Brand } from "../brand/Brand";
import type { UploadedVideo } from "../library/UploadVideo";
import { VideoPlayer, type PlayerController } from "../player/VideoPlayer";
import { ViewingSidebar } from "./ViewingSidebar";
import { ResultActions } from "./ResultActions";
import { PlatformVideoPlayer } from "../player/PlatformVideoPlayer";

type WatchingWorkspaceProps = {
  user: PublicUser;
  credits: CreditBalance | null;
  video: UploadedVideo;
  run: AnalysisRun | null;
  playerRef: RefObject<PlayerController | null>;
  onTerminal: (run: AnalysisRun) => void;
  onLogout: () => void;
  onAttach: (url: string, fileName: string) => void;
  onDeleted: () => void;
};

export function WatchingWorkspace({ user, credits, video, run, playerRef, onTerminal, onLogout, onAttach, onDeleted }: WatchingWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const remote = video.sourcePlatform === "youtube" || video.sourcePlatform === "bilibili";
  const stopped = run?.status === "failed" || run?.status === "cancelled";
  const heading = ({ completed: "AI 分析已完成", failed: "AI 分析失败", cancelled: "AI 分析已取消", cancelling: "正在取消分析", queued: "等待分析开始" } as Record<string, string>)[run?.status ?? "queued"] ?? "AI 正在分析视频内容";
  const seek = (seconds: number) => playerRef.current?.seek(seconds);
  useEffect(() => () => {
    if (video.playbackUrl.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(video.playbackUrl);
  }, [video.playbackUrl]);

  return <main className="watching-shell">
    <header className="topbar watching-topbar">
      <Brand />
      <div className="user-menu">
        <span className="credit-badge">{credits ? `${credits.available} 积分可用` : "积分加载中"}</span>
        <span>{user.email}</span>
        <a className="account-link" href="/account">个人中心</a>
        <button className="text-button" type="button" onClick={onLogout}>退出</button>
      </div>
    </header>
    <div className="watching-grid">
      <section className="watching-stage">
        <div className="watching-meta">
          <div><h1>{video.fileName}</h1><p>{heading}</p></div>
          <div className="watching-actions"><span className="sync-state"><i aria-hidden="true" />{run?.status === "completed" ? "笔记、章节与逐字稿已同步" : stopped ? "本次分析已停止" : "分析结果将自动更新"}</span>{run?.notes && <a className="notes-link" href={`/notes?run=${encodeURIComponent(run.id)}`}>查看 AI 笔记</a>}{!remote && <button className="sound-button" type="button" onClick={() => playerRef.current?.enableSound()}>开启声音</button>}</div>
        </div>
        {remote ? <PlatformVideoPlayer ref={playerRef} sourceUrl={video.sourceUrl} title={video.fileName} onTimeUpdate={setCurrentTime} /> : <VideoPlayer ref={playerRef} src={video.playbackUrl} title={video.fileName} emptyLabel="服务器原视频已删除，可重新选择本地原视频播放" onTimeUpdate={setCurrentTime} />}
        {run && <ResultActions run={run} onAttach={onAttach} onDeleted={onDeleted} allowLocalAttach={!remote} />}
        {run?.resultAvailability === "expired" && <p className="expiry-notice">隐私结果已到期，逐字稿、摘要、章节和 AI 笔记已删除。</p>}
        {stopped && <section className="progress-card" role="status"><p className={run?.status === "failed" ? "error-text" : undefined}>{run?.status === "failed" ? run.failure?.message ?? "本次分析失败，未生成完整结果。" : "本次分析已取消。"}</p><a className="notes-link" href="/">返回工作台</a></section>}
        {!run || !["completed", "failed", "cancelled"].includes(run.status) ? <AnalysisProgress runId={run?.id} onTerminal={onTerminal} /> : null}
      </section>
      <ViewingSidebar run={run} currentTime={currentTime} onSeek={seek} />
    </div>
  </main>;
}
