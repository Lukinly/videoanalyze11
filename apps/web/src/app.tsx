import { useEffect, useRef, useState } from "react";
import { api, type AnalysisRun, type CreditBalance, type PublicUser } from "./api/client";
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

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [verifyToken, setVerifyToken] = useState<string | undefined>();
  const [resetToken, setResetToken] = useState<string | undefined>();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const playerRef = useRef<PlayerController>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? undefined;
    if (window.location.pathname === "/verify-email") setVerifyToken(token);
    if (window.location.pathname === "/reset-password") setResetToken(token);
    void api.getMe().then((nextUser) => { setUser(nextUser); void api.getCredits().then(setCredits, () => setCredits(null)); }, () => setUser(null)).finally(() => setCheckingAuth(false));
  }, []);

  if (verifyToken || window.location.pathname === "/verify-email") return <VerifyEmailPage token={verifyToken} onDone={() => { window.history.replaceState({}, "", "/"); setVerifyToken(undefined); setAuthView("login"); }} />;
  if (resetToken || window.location.pathname === "/reset-password") return <ResetPasswordPage token={resetToken} onDone={() => { window.history.replaceState({}, "", "/"); setResetToken(undefined); setAuthView("login"); }} />;
  if (checkingAuth) return <main className="loading-shell"><Brand />正在打开工作台…</main>;
  if (!user) return authView === "login" ? <LoginPage onSuccess={setUser} onRegister={() => setAuthView("register")} /> : <RegisterPage onLogin={() => setAuthView("login")} />;
  if (user.mustChangePassword) return <ResetPasswordPage forceChange onDone={() => { void api.getMe().then(setUser); }} />;
  const logout = () => { void api.logout().finally(() => { setUser(null); setVideo(null); setRun(null); setCredits(null); }); };
  if (user.role === "admin" && window.location.pathname === "/admin") return <AdminPage />;
  if (window.location.pathname === "/account") return <AccountPage user={user} onLogout={logout} />;

  async function handleUploaded(uploaded: UploadedVideo) {
    setVideo(uploaded);
    const started = await api.startAnalysis(uploaded.videoId);
    setRun(started);
  }

  const completed = (completedRun: AnalysisRun) => { setRun(completedRun); void api.getCredits().then(setCredits); };

  return video
    ? <WatchingWorkspace user={user} credits={credits} video={video} run={run} playerRef={playerRef} onLogout={logout} onCompleted={completed} />
    : <HomePage user={user} credits={credits} onLogout={logout} onUploaded={(uploaded) => { void handleUploaded(uploaded); }} />;
}

function HomePage({ user, credits, onLogout, onUploaded }: { user: PublicUser; credits: CreditBalance | null; onLogout: () => void; onUploaded: (video: UploadedVideo) => void }) {
  return <main className="app-shell home-shell">
    <header className="topbar"><Brand /><div className="user-menu"><span className="credit-badge">{credits ? `${credits.available} 积分可用` : "积分加载中"}</span>{user.role === "admin" && <a className="text-button" href="/admin">后台</a>}<span>{user.email}</span><a className="account-link" href="/account">个人中心</a><button className="text-button" type="button" onClick={onLogout}>退出</button></div></header>
    <div className="home-content">
      <div className="hero-copy"><p className="eyebrow">Your private video desk</p><h1>把每段视频，变成<br /><em>可搜索的知识。</em></h1><p>上传、转写、定位。AI 在后台处理，你在前台掌控每一个时间点。</p></div>
      <UploadVideo availableCredits={credits?.available} onUploaded={onUploaded} />
    </div>
  </main>;
}
