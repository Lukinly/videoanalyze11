import { useState, type FormEvent } from "react";
import { api, type PublicUser } from "../api/client";
import { Brand } from "../brand/Brand";
import { CreditsPanel } from "../credits/CreditsPanel";

export function AccountPage({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.changePassword({ password, confirmPassword });
      setPassword("");
      setConfirmPassword("");
      setMessage("密码已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码更新失败");
    } finally {
      setBusy(false);
    }
  }

  return <main className="account-shell">
    <header className="topbar account-topbar">
      <Brand />
      <div className="user-menu"><a className="account-link" href="/">返回主页</a><button className="text-button" type="button" onClick={onLogout}>退出登录</button></div>
    </header>
    <div className="account-content">
      <div className="account-heading"><p className="eyebrow">Account</p><h1>个人中心</h1><p>管理积分、充值申请和账号安全。</p></div>
      <div className="account-grid">
        <section className="account-card profile-card"><p className="eyebrow">Profile</p><h2>账号信息</h2><dl><div><dt>邮箱</dt><dd>{user.email}</dd></div><div><dt>账号类型</dt><dd>{user.role === "admin" ? "管理员" : "普通用户"}</dd></div></dl></section>
        <CreditsPanel />
        <section className="account-card password-card"><p className="eyebrow">Security</p><h2>修改密码</h2><form className="stack-form" onSubmit={changePassword}>
          <label htmlFor="account-password">新密码<input id="account-password" aria-label="新密码" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label htmlFor="account-confirm-password">确认密码<input id="account-confirm-password" aria-label="确认密码" required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {message && <p className="success-box">{message}</p>}
          {error && <p className="error-text">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? "保存中…" : "保存新密码"}</button>
        </form></section>
      </div>
    </div>
  </main>;
}
