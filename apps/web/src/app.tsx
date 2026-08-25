import { useEffect, useRef, useState } from "react";
import { api, type AnalysisRun, type CreditBalance, type LinkPreview, type PublicUser } from "./api/client";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { VerifyEmailPage } from "./auth/VerifyEmailPage";
import { UploadVideo, type UploadedVideo } from "./library/UploadVideo";
import type { PlayerController } from "./player/VideoPlayer";
import { AdminPage } from "./admin/AdminPage";
import { ResetPasswordPage } from "./auth/ResetPasswordPage";
import { Brand } from "./brand/Brand";
import { WatchingWorkspace } from "./viewing/WatchingWorkspace";
import { AccountPage } from "./account/AccountPage";
import { AnalysisHistory } from "./library/AnalysisHistory";
import { NotesPage } from "./notes/NotesPage";
import { LinkVideo } from "./library/LinkVideo";

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [verifyToken, setVerifyToken] = useState<string | undefined>();
  const [resetToken, setResetToken] = useState<string | undefined>();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const playerRef = useRef<PlayerController>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? undefined;
    if (window.location.pathname === "/verify-email") setVerifyToken(token);
    if (window.location.pathname === "/reset-password") setResetToken(token);
    void (async () => {
      let nextUser: PublicUser;
      try {
        nextUser = await api.getMe();
      } catch {
        setUser(null);
        setCheckingAuth(false);
        return;
      }
      setUser(nextUser);
      const [nextCredits, nextHistory] = await Promise.all([
        api.getCredits().catch(() => null),
        api.listAnalyses().catch(() => ({ items: [] as AnalysisRun[] }))
      ]);
      setCredits(nextCredits);
      setHistory(nextHistory.items);
      const runId = new URLSearchParams(window.location.search).get("run");
      if (runId) {
        let restored: AnalysisRun | undefined;
        try { restored = await api.getAnalysis(runId); }
        catch (error) {
          const historical = nextHistory.items.find((item) => item.id === runId);
          if (historical && (error as { status?: number }).status === 410) restored = historical;
        }
        if (restored) {
          let playbackUrl = "";
          try { playbackUrl = (await api.getPlaybackUrl(restored.videoId)).url; } catch { /* terminal media is intentionally absent */ }
          setRun(restored);
          setVideo({ videoId: restored.videoId, fileName: restored.fileName ?? "已删除的视频", playbackUrl, fileSize: 0, estimatedCost: 0, retentionMode: restored.retentionMode ?? "standard", sourcePlatform: restored.sourcePlatform, sourceUrl: restored.sourceUrl, sourceAuthor: restored.sourceAuthor, thumbnailUrl: restored.thumbnailUrl });
        }
      }
      setCheckingAuth(false);
    })();
  }, []);

  if (verifyToken || window.location.pathname === "/verify-email") return <VerifyEmailPage token={verifyToken} onDone={() => { window.history.replaceState({}, "", "/"); setVerifyToken(undefined); setAuthView("login"); }} />;
  if (resetToken || window.location.pathname === "/reset-password") return <ResetPasswordPage token={resetToken} onDone={() => { window.history.replaceState({}, "", "/"); setResetToken(undefined); setAuthView("login"); }} />;
  if (checkingAuth) return <main className="loading-shell"><Brand />正在打开工作台…</main>;
  if (!user) return authView === "login" ? <LoginPage onSuccess={setUser} onRegister={() => setAuthView("register")} /> : <RegisterPage onLogin={() => setAuthView("login")} />;
  if (user.mustChangePassword) return <ResetPasswordPage forceChange onDone={() => { void api.getMe().then(setUser); }} />;
  const logout = () => { void api.logout().finally(() => { setUser(null); setVideo(null); setRun(null); setCredits(null); }); };
  if (user.role === "admin" && window.location.pathname === "/admin") return <AdminPage />;
  if (window.location.pathname === "/account") return <AccountPage user={user} onLogout={logout} />;
  if (window.location.pathname === "/notes" && run && video) return <NotesPage run={run} playbackUrl={video.playbackUrl} playerRef={playerRef} onAttach={(url, fileName) => setVideo((current) => current ? { ...current, playbackUrl: url, fileName } : current)} />;

  async function handleUploaded(uploaded: UploadedVideo) {
    setVideo(uploaded);
    const started = await api.startAnalysis(uploaded.videoId, uploaded.retentionMode);
    setRun(started);
  }
  async function handleLinked(preview: LinkPreview & { videoId: string }) {
    const linked: UploadedVideo = { videoId: preview.videoId, fileName: preview.title, playbackUrl: "", fileSize: 0, estimatedCost: preview.estimatedCost, retentionMode: "standard", sourcePlatform: preview.platform, sourceUrl: preview.canonicalUrl, sourceAuthor: preview.author, thumbnailUrl: preview.thumbnailUrl };
    const started = await api.startAnalysis(preview.videoId, "standard");
    setVideo(linked);
    setRun({ ...started, sourcePlatform: preview.platform, sourceUrl: preview.canonicalUrl, sourceAuthor: preview.author, thumbnailUrl: preview.thumbnailUrl, fileName: preview.title, duration: preview.duration });
    void api.getCredits().then(setCredits);
    void api.listAnalyses().then((result) => setHistory(result.items));
  }

  const completed = (completedRun: AnalysisRun) => { setRun(completedRun); void api.getCredits().then(setCredits); };

  return video
    ? <WatchingWorkspace user={user} credits={credits} video={video} run={run} playerRef={playerRef} onLogout={logout} onCompleted={completed} onAttach={(url, fileName) => setVideo((current) => current ? { ...current, playbackUrl: url, fileName } : current)} onDeleted={() => { setVideo(null); setRun(null); window.history.replaceState({}, "", "/"); void api.listAnalyses().then((result) => setHistory(result.items)); }} />
    : <HomePage user={user} credits={credits} history={history} onLogout={logout} onUploaded={(uploaded) => { void handleUploaded(uploaded); }} onLinked={handleLinked} />;
}

function HomePage({ user, credits, history, onLogout, onUploaded, onLinked }: { user: PublicUser; credits: CreditBalance | null; history: AnalysisRun[]; onLogout: () => void; onUploaded: (video: UploadedVideo) => void; onLinked: (preview: LinkPreview & { videoId: string }) => Promise<void> }) {
  const [sourceMode, setSourceMode] = useState<"upload" | "link">("upload");
  return <main className="app-shell home-shell">
    <header className="topbar"><Brand /><div className="user-menu"><span className="credit-badge">{credits ? `${credits.available} 积分可用` : "积分加载中"}</span>{user.role === "admin" && <a className="text-button" href="/admin">后台</a>}<span>{user.email}</span><a className="account-link" href="/account">个人中心</a><button className="text-button" type="button" onClick={onLogout}>退出</button></div></header>
    <div className="home-content">
      <div className="hero-copy"><p className="eyebrow">Your private video desk</p><h1>把每段视频，变成<br /><em>可搜索的知识。</em></h1><p>上传、转写、定位。AI 在后台处理，你在前台掌控每一个时间点。</p></div>
      <div className="source-picker"><div className="source-picker-tabs" aria-label="视频传入方式"><button className={sourceMode === "upload" ? "is-active" : ""} type="button" aria-pressed={sourceMode === "upload"} onClick={() => setSourceMode("upload")}>上传视频解析</button><button className={sourceMode === "link" ? "is-active" : ""} type="button" aria-pressed={sourceMode === "link"} onClick={() => setSourceMode("link")}>输入链接解析</button></div>{sourceMode === "upload" ? <UploadVideo availableCredits={credits?.available} onUploaded={onUploaded} /> : <LinkVideo availableCredits={credits?.available} previewLink={api.previewLink} confirmLink={api.confirmLink} onConfirmed={onLinked} />}</div>
      <AnalysisHistory items={history} />
    </div>
  </main>;
}
