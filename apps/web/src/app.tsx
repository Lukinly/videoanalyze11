import { useEffect, useRef, useState } from "react";
import { api, type AnalysisRun, type PublicUser } from "./api/client";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { VerifyEmailPage } from "./auth/VerifyEmailPage";
import { AnalysisProgress } from "./analysis/AnalysisProgress";
import { UploadVideo, type UploadedVideo } from "./library/UploadVideo";
import { VideoPlayer, type PlayerController } from "./player/VideoPlayer";
import { TranscriptPanel } from "./transcript/TranscriptPanel";
import { SummaryPanel } from "./summary/SummaryPanel";
import { ChapterList } from "./chapters/ChapterList";
import { SearchPanel } from "./search/SearchPanel";

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [verifyToken, setVerifyToken] = useState<string | undefined>();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const playerRef = useRef<PlayerController>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? undefined;
    if (window.location.pathname === "/verify-email") setVerifyToken(token);
    void api.getMe().then(setUser, () => setUser(null)).finally(() => setCheckingAuth(false));
  }, []);

  if (verifyToken || window.location.pathname === "/verify-email") return <VerifyEmailPage token={verifyToken} onDone={() => { window.history.replaceState({}, "", "/"); setVerifyToken(undefined); setAuthView("login"); }} />;
  if (checkingAuth) return <main className="loading-shell"><span className="brand-dot" /> 正在打开工作台…</main>;
  if (!user) return authView === "login" ? <LoginPage onSuccess={setUser} onRegister={() => setAuthView("register")} /> : <RegisterPage onLogin={() => setAuthView("login")} />;

  async function handleUploaded(uploaded: UploadedVideo) {
    setVideo(uploaded);
    const started = await api.startAnalysis(uploaded.videoId);
    setRun(started);
  }

  return <Workspace user={user} video={video} run={run} playerRef={playerRef} onLogout={() => { void api.logout().finally(() => { setUser(null); setVideo(null); setRun(null); }); }} onUploaded={(uploaded) => { void handleUploaded(uploaded); }} onCompleted={setRun} />;
}

function Workspace({ user, video, run, playerRef, onLogout, onUploaded, onCompleted }: { user: PublicUser; video: UploadedVideo | null; run: AnalysisRun | null; playerRef: React.RefObject<PlayerController | null>; onLogout: () => void; onUploaded: (video: UploadedVideo) => void; onCompleted: (run: AnalysisRun) => void }) {
  const segments = run?.transcript?.segments ?? [];
  return <main className="app-shell">
    <header className="topbar"><div className="brand-lockup"><span className="brand-dot" /> videoanalyze</div><div className="user-menu"><span>{user.email}</span><button className="text-button" type="button" onClick={onLogout}>退出</button></div></header>
    <div className="workspace-grid">
      <div className="main-column"><div className="hero-copy"><p className="eyebrow">Your private video desk</p><h1>把每段视频，变成<br /><em>可搜索的知识。</em></h1><p>上传、转写、定位。AI 在后台处理，你在前台掌控每一个时间点。</p></div>{!video ? <UploadVideo onUploaded={onUploaded} /> : <VideoPlayer ref={playerRef} src={video.playbackUrl} title={video.fileName} />}<AnalysisProgress runId={run?.id} onCompleted={onCompleted} /></div>
      <aside className="side-column"><SummaryPanel oneLineSummary={run?.summary?.oneLineSummary} overallSummary={run?.summary?.overallSummary} /><ChapterList chapters={(run?.summary?.chapters ?? []).flatMap((chapter) => chapter.start === undefined || chapter.end === undefined ? [] : [{ id: chapter.id, title: chapter.title, start: chapter.start, end: chapter.end, summary: chapter.summary, alignmentWarning: chapter.alignmentWarning }])} onSeek={(seconds) => playerRef.current?.seek(seconds)} /><SearchPanel runId={run?.id} onSeek={(seconds) => playerRef.current?.seek(seconds)} /><TranscriptPanel segments={segments} onSeek={(seconds) => playerRef.current?.seek(seconds)} /></aside>
    </div>
  </main>;
}
