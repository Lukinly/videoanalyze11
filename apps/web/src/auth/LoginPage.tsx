import { useState, type FormEvent } from "react";
import { api, type PublicUser } from "../api/client";

export function LoginPage({ onSuccess, onRegister }: { onSuccess: (user: PublicUser) => void; onRegister: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login({ email, password });
      onSuccess(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard eyebrow="Private video intelligence" title="登录你的工作台">
      <form className="stack-form" onSubmit={submit}>
        <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>密码<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "登录中…" : "登录"}</button>
      </form>
      <p className="form-footnote">还没有账号？ <button className="text-button" type="button" onClick={onRegister}>注册新账号</button></p>
    </AuthCard>
  );
}

function AuthCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <main className="auth-shell"><div className="brand-lockup"><span className="brand-dot" /> videoanalyze</div><section className="auth-card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section></main>;
}
