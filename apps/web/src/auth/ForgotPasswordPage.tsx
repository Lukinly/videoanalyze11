import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { AuthCard } from "./AuthCard";

export function ForgotPasswordPage({ initialEmail = "", onLogin, embedded = false }: { initialEmail?: string; onLogin: () => void; embedded?: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword({ email: email.trim() });
      setSent(true);
      setCooldown(60);
    } catch {
      setError("重置邮件发送失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <AuthCard eyebrow="Password recovery" title="忘记密码" embedded={embedded}>
    <p className="auth-description">输入注册邮箱，我们会向你发送密码重置链接。</p>
    <form className="stack-form" onSubmit={submit}>
      <label htmlFor="forgot-email">邮箱<input id="forgot-email" required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setSent(false); setError(null); }} /></label>
      {sent && <div className="success-box" role="status">如果该邮箱已注册，你将收到一封重置邮件。链接 1 小时内有效，请同时检查垃圾邮件。</div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || cooldown > 0} type="submit">{busy ? "发送中…" : cooldown > 0 ? `${cooldown} 秒后可重新发送` : sent ? "重新发送重置链接" : "发送重置链接"}</button>
    </form>
    <p className="form-footnote"><button className="text-button" type="button" onClick={onLogin}>返回登录</button></p>
  </AuthCard>;
}
