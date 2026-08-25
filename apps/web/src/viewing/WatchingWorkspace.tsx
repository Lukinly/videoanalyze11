import { useEffect, useState, type RefObject } from "react";
import type { AnalysisRun, CreditBalance, PublicUser } from "../api/client";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { Brand } from "../brand/Brand";
import type { UploadedVideo } from "../library/UploadVideo";
import { VideoPlayer, type PlayerController } from "../player/VideoPlayer";
import { ViewingSidebar } from "./ViewingSidebar";
import { ResultActions } from "./ResultActions";
import { timestampedVideoUrl } from "@videoanalyze/domain";

type WatchingWorkspaceProps = {
  user: PublicUser;
  credits: CreditBalance | null;
  video: UploadedVideo;
  run: AnalysisRun | null;
  playerRef: RefObject<PlayerController | null>;
  onCompleted: (run: AnalysisRun) => void;
  onLogout: () => void;
  onAttach: (url: string, fileName: string) => void;
  onDeleted: () => void;
};

export function WatchingWorkspace({ user, credits, video, run, playerRef, onCompleted, onLogout, onAttach, onDeleted }: WatchingWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const remote = video.sourcePlatform === "youtube" || video.sourcePlatform === "bilibili";
  const seek = (seconds: number) => {
    if (remote && video.sourceUrl) window.open(timestampedVideoUrl(video.sourceUrl, seconds), "_blank", "noopener,noreferrer");
    else playerRef.current?.seek(seconds);
  };
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
          <div><h1>{video.fileName}</h1><p>{run?.status === "completed" ? "AI 分析已完成" : "AI 正在分析视频内容"}</p></div>
          <div className="watching-actions"><span className="sync-state"><i aria-hidden="true" />{run?.status === "completed" ? "笔记、章节与逐字稿已同步" : "分析结果将自动更新"}</span>{run?.notes && <a className="notes-link" href={`/notes?run=${encodeURIComponent(run.id)}`}>查看 AI 笔记</a>}<button className="sound-button" type="button" onClick={() => playerRef.current?.enableSound()}>开启声音</button></div>
        </div>
        {remote ? <section className="external-source-card">{video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" />}<div><span className="source-badge">{video.sourcePlatform === "youtube" ? "YouTube" : "B站"}</span><h2>{video.fileName}</h2>{video.sourceAuthor && <p>{video.sourceAuthor}</p>}<a className="primary-button" href={video.sourceUrl ?? "#"} target="_blank" rel="noreferrer">原视频</a></div></section> : <VideoPlayer ref={playerRef} src={video.playbackUrl} title={video.fileName} emptyLabel="服务器原视频已删除，可重新选择本地原视频播放" onTimeUpdate={setCurrentTime} />}
        {run && <ResultActions run={run} onAttach={onAttach} onDeleted={onDeleted} />}
        {run?.resultAvailability === "expired" && <p className="expiry-notice">隐私结果已到期，逐字稿、摘要、章节和 AI 笔记已删除。</p>}
        {!run || !["completed", "failed", "cancelled"].includes(run.status) ? <AnalysisProgress runId={run?.id} onCompleted={onCompleted} /> : null}
      </section>
      <ViewingSidebar run={run} currentTime={currentTime} onSeek={seek} />
    </div>
  </main>;
}
