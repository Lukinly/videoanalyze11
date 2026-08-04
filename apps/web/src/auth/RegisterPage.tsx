import { useState, type FormEvent } from "react";
import { api } from "../api/client";

export function RegisterPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register({ email, password });
      setMessage("验证邮件已发送。请完成邮箱验证后再登录。新用户有 2 次试用额度。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell"><div className="brand-lockup"><span className="brand-dot" /> videoanalyze</div><section className="auth-card">
      <p className="eyebrow">Start with two trials</p><h1>创建账号</h1>
      {message ? <div className="success-box"><p>{message}</p><button className="primary-button" type="button" onClick={onLogin}>返回登录</button></div> : <form className="stack-form" onSubmit={submit}>
        <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>密码<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>至少 8 位字符</small></label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "创建中…" : "创建账号"}</button>
      </form>}
      {!message && <p className="form-footnote">已有账号？ <button className="text-button" type="button" onClick={onLogin}>返回登录</button></p>}
    </section></main>
  );
}
