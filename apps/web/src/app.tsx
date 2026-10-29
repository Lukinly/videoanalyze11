import { useEffect, useRef, useState } from "react";
import { api, type AnalysisRun, type CreditBalance, type LinkPreview, type PublicUser } from "./api/client";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { VerifyEmailPage } from "./auth/VerifyEmailPage";
import { UploadVideo, type UploadedVideo } from "./library/UploadVideo";
import type { PlayerController } from "./player/VideoPlayer";
import { AdminPage } from "./admin/AdminPage";
import { ResetPasswordPage } from "./auth/ResetPasswordPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { Brand } from "./brand/Brand";
import { WatchingWorkspace } from "./viewing/WatchingWorkspace";
import { AccountPage } from "./account/AccountPage";
import { AnalysisHistory } from "./library/AnalysisHistory";
import { NotesPage } from "./notes/NotesPage";
import { LinkVideo } from "./library/LinkVideo";
import { AuthDialog } from "./auth/AuthDialog";
import { PublicFeatures, PublicPreview } from "./library/PublicPreview";

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authView, setAuthView] = useState<"login" | "register" | "forgot">(() => window.location.pathname === "/forgot-password" ? "forgot" : window.location.pathname === "/register" ? "register" : "login");
  const [authOpen, setAuthOpen] = useState(() => ["/login", "/register", "/forgot-password"].includes(window.location.pathname));
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [authNotice, setAuthNotice] = useState<string>();
  const [verifyToken, setVerifyToken] = useState<string | undefined>(() => window.location.pathname === "/verify-email" ? new URLSearchParams(window.location.search).get("token") ?? undefined : undefined);
  const [resetToken, setResetToken] = useState<string | undefined>(() => window.location.pathname === "/reset-password" ? new URLSearchParams(window.location.search).get("token") ?? undefined : undefined);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const playerRef = useRef<PlayerController>(null);
  const sessionVersion = useRef(0);

  async function restoreSession(nextUser: PublicUser) {
      const version = ++sessionVersion.current;
      setCheckingAuth(true);
      setUser(nextUser);
      const [nextCredits, nextHistory] = await Promise.all([
        api.getCredits().catch(() => null),
        api.listAnalyses().catch(() => ({ items: [] as AnalysisRun[] }))
      ]);
      if (version !== sessionVersion.current) return;
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
          if (restored.sourcePlatform !== "youtube" && restored.sourcePlatform !== "bilibili") {
            try { playbackUrl = (await api.getPlaybackUrl(restored.videoId)).url; } catch { /* terminal media is intentionally absent */ }
          }
          if (version !== sessionVersion.current) return;
          setRun(restored);
          setVideo({ videoId: restored.videoId, fileName: restored.fileName ?? "已删除的视频", playbackUrl, fileSize: 0, estimatedCost: 0, retentionMode: restored.retentionMode ?? "standard", sourcePlatform: restored.sourcePlatform, sourceUrl: restored.sourceUrl, sourceAuthor: restored.sourceAuthor, thumbnailUrl: restored.thumbnailUrl });
        }
      }
      if (version !== sessionVersion.current) return;
      setCheckingAuth(false);
  }

  useEffect(() => {
    let active = true;
    const version = sessionVersion.current;
    void api.getMe().then((nextUser) => { if (active && version === sessionVersion.current) void restoreSession(nextUser); }, () => {
      if (!active || version !== sessionVersion.current) return;
      setUser(null);
      setCheckingAuth(false);
      if (["/account", "/admin", "/notes"].includes(window.location.pathname) || new URLSearchParams(window.location.search).has("run")) setAuthOpen(true);
    });
    return () => { active = false; };
  }, []);

  if (verifyToken || window.location.pathname === "/verify-email") return <VerifyEmailPage token={verifyToken} onDone={() => { window.history.replaceState({}, "", "/"); setVerifyToken(undefined); setAuthView("login"); setAuthOpen(true); }} />;
  const showLogin = () => { if (["/reset-password", "/forgot-password", "/login", "/register"].includes(window.location.pathname)) window.history.replaceState({}, "", "/"); setResetToken(undefined); setAuthView("login"); setAuthOpen(true); };
  const showForgotPassword = (email = "") => { if (window.location.pathname === "/reset-password") window.history.replaceState({}, "", "/"); setResetToken(undefined); setRecoveryEmail(email); setAuthNotice(undefined); setAuthView("forgot"); setAuthOpen(true); };
  if (resetToken || window.location.pathname === "/reset-password") return <ResetPasswordPage token={resetToken} onRequestReset={() => showForgotPassword()} onLogin={showLogin} onDone={() => { sessionVersion.current += 1; setCheckingAuth(false); setUser(null); setCredits(null); setHistory([]); setVideo(null); setRun(null); setAuthNotice("密码已重置，请使用新密码登录。"); showLogin(); }} />;
  if (checkingAuth && user && new URLSearchParams(window.location.search).has("run")) return <main className="loading-shell"><Brand />正在打开工作台…</main>;
  if (user?.mustChangePassword) return <ResetPasswordPage forceChange onDone={() => { void api.getMe().then(setUser); }} />;
  const logout = () => { void api.logout().finally(() => { sessionVersion.current += 1; setUser(null); setVideo(null); setRun(null); setCredits(null); setHistory([]); setCheckingAuth(false); setAuthView("login"); setAuthOpen(false); window.history.replaceState({}, "", "/"); }); };
  if (user?.role === "admin" && window.location.pathname === "/admin") return <AdminPage />;
  if (user && window.location.pathname === "/account") return <AccountPage user={user} onLogout={logout} />;
  if (user && window.location.pathname === "/notes" && run && video) return <NotesPage run={run} playbackUrl={video.playbackUrl} playerRef={playerRef} onAttach={(url, fileName) => setVideo((current) => current ? { ...current, playbackUrl: url, fileName } : current)} />;

  async function handleUploaded(uploaded: UploadedVideo) {
    const started = await api.startAnalysis(uploaded.videoId, uploaded.retentionMode);
    setVideo(uploaded);
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

  return <>
    {video && user
      ? <WatchingWorkspace user={user} credits={credits} video={video} run={run} playerRef={playerRef} onLogout={logout} onCompleted={completed} onAttach={(url, fileName) => setVideo((current) => current ? { ...current, playbackUrl: url, fileName } : current)} onDeleted={() => { setVideo(null); setRun(null); window.history.replaceState({}, "", "/"); void api.listAnalyses().then((result) => setHistory(result.items)); }} />
      : <HomePage user={user} credits={credits} history={history} onLogin={showLogin} onLogout={logout} onUploaded={handleUploaded} onLinked={handleLinked} />}
    {authOpen && (!user || authView === "forgot") && <AuthDialog view={authView} onViewChange={(view) => { setAuthNotice(undefined); setAuthView(view); }} onClose={() => { setAuthOpen(false); if (window.location.pathname !== "/" || window.location.search) window.history.replaceState({}, "", "/"); }}>
      {authView === "login" ? <LoginPage embedded notice={authNotice} onForgotPassword={showForgotPassword} onSuccess={(loggedIn) => { setAuthNotice(undefined); setAuthOpen(false); void restoreSession(loggedIn); }} onRegister={() => { setAuthNotice(undefined); setAuthView("register"); }} />
        : authView === "register" ? <RegisterPage embedded onLogin={showLogin} /> : <ForgotPasswordPage embedded initialEmail={recoveryEmail} onLogin={showLogin} />}
    </AuthDialog>}
  </>;
}

function HomePage({ user, credits, history, onLogin, onLogout, onUploaded, onLinked }: { user: PublicUser | null; credits: CreditBalance | null; history: AnalysisRun[]; onLogin: () => void; onLogout: () => void; onUploaded: (video: UploadedVideo) => void | Promise<void>; onLinked: (preview: LinkPreview & { videoId: string }) => Promise<void> }) {
  const [sourceMode, setSourceMode] = useState<"upload" | "link">("upload");
  return <main className={`app-shell home-shell${user ? "" : " public-home"}`}>
    {!user && <div className="public-announcement">从观看到理解，让知识留下来。<a href="#start-analysis">开始体验 <span aria-hidden="true">↗</span></a></div>}
    <header className="topbar"><Brand />{!user && <nav className="public-nav" aria-label="首页导航"><a href="#product-preview">产品预览</a><a href="#features">功能亮点</a><a href="#start-analysis">开始使用</a></nav>}{user ? <div className="user-menu"><span className="credit-badge">{credits ? `${credits.available} 积分可用` : "积分加载中"}</span>{user.role === "admin" && <a className="text-button" href="/admin">后台</a>}<span>{user.email}</span><a className="account-link" href="/account">个人中心</a><button className="text-button" type="button" onClick={onLogout}>退出</button></div> : <div className="public-nav-actions"><button className="public-login-button" type="button" onClick={onLogin}>登录</button><a className="primary-button" href="#start-analysis">开始生成笔记 <span aria-hidden="true">↗</span></a></div>}</header>
    <div className="home-content">
      <div className="hero-copy" key="hero"><p className="eyebrow">{user ? "Your private video desk" : "WATCH. UNDERSTAND. REMEMBER."}</p>{!user && <span className="public-hero-badge"><span aria-hidden="true">✦</span> 你的 AI 视频笔记工作台</span>}<h1>把每段视频，变成<br /><em>可搜索的知识。</em></h1><p>{user ? "上传、转写、定位。AI 在后台处理，你在前台掌控每一个时间点。" : "自动整理逐字稿、章节与重点笔记。结合原视频画面，读懂每一个片段，随时回到关键时刻。"}</p>{!user && <><div className="public-hero-actions"><a className="primary-button" href="#start-analysis">开始分析视频 <span aria-hidden="true">↗</span></a><a className="public-demo-link" href="#product-preview">看看笔记长什么样 <span aria-hidden="true">↓</span></a></div><p className="public-hero-footnote"><span>本地上传 / 公开链接</span><span>新账号获赠 12 积分</span></p></>}</div>
      {!user && <PublicPreview key="preview" />}
      <div className="source-picker" id="start-analysis" key="source-picker">{!user && <header className="public-section-heading" key="intro"><p className="eyebrow">YOUR NEXT GOOD NOTE</p><h2>从一段你想读懂的视频开始。</h2><p>先选好视频，开始分析时再登录。</p></header>}<div className="source-picker-tabs" key="tabs" aria-label="视频传入方式"><button className={sourceMode === "upload" ? "is-active" : ""} type="button" aria-pressed={sourceMode === "upload"} onClick={() => setSourceMode("upload")}>上传视频解析</button><button className={sourceMode === "link" ? "is-active" : ""} type="button" aria-pressed={sourceMode === "link"} onClick={() => setSourceMode("link")}>输入链接解析</button></div>{sourceMode === "upload" ? <UploadVideo key="upload" availableCredits={credits?.available} onUploaded={onUploaded} onRequireLogin={user ? undefined : onLogin} /> : <LinkVideo key="link" availableCredits={credits?.available} previewLink={api.previewLink} confirmLink={api.confirmLink} onConfirmed={onLinked} onRequireLogin={user ? undefined : onLogin} />}</div>
      {user && <AnalysisHistory key="history" items={history} />}
    </div>
    {!user && <><PublicFeatures /><footer className="public-footer"><Brand /><span>把看过的内容，变成自己的知识。</span><a href="#start-analysis">开始整理下一段视频 ↑</a></footer></>}
  </main>;
}
