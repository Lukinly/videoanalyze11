import { useState, type RefObject } from "react";
import type { AnalysisRun, CreditBalance, PublicUser } from "../api/client";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { Brand } from "../brand/Brand";
import type { UploadedVideo } from "../library/UploadVideo";
import { VideoPlayer, type PlayerController } from "../player/VideoPlayer";
import { ViewingSidebar } from "./ViewingSidebar";

type WatchingWorkspaceProps = {
  user: PublicUser;
  credits: CreditBalance | null;
  video: UploadedVideo;
  run: AnalysisRun | null;
  playerRef: RefObject<PlayerController | null>;
  onCompleted: (run: AnalysisRun) => void;
  onLogout: () => void;
};

export function WatchingWorkspace({ user, credits, video, run, playerRef, onCompleted, onLogout }: WatchingWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);

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
          <div className="watching-actions"><span className="sync-state"><i aria-hidden="true" />{run?.status === "completed" ? "章节与逐字稿已同步" : "分析结果将自动更新"}</span><button className="sound-button" type="button" onClick={() => playerRef.current?.enableSound()}>开启声音</button></div>
        </div>
        <VideoPlayer ref={playerRef} src={video.playbackUrl} title={video.fileName} onTimeUpdate={setCurrentTime} />
        <AnalysisProgress runId={run?.id} onCompleted={onCompleted} />
      </section>
      <ViewingSidebar run={run} currentTime={currentTime} onSeek={(seconds) => playerRef.current?.seek(seconds)} />
    </div>
  </main>;
}
