import { useState, type FormEvent } from "react";
import { api, type PublicUser } from "../api/client";
import { AuthCard } from "./AuthCard";

export function LoginPage({ onSuccess, onRegister, onForgotPassword, notice, embedded = false }: { onSuccess: (user: PublicUser) => void; onRegister: () => void; onForgotPassword: (email: string) => void; notice?: string; embedded?: boolean }) {
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
    <AuthCard eyebrow="Private video intelligence" title="登录你的工作台" embedded={embedded}>
      {notice && <p className="success-box" role="status">{notice}</p>}
      <form className="stack-form" onSubmit={submit}>
        <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>密码<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="auth-actions"><button className="text-button" type="button" onClick={() => onForgotPassword(email)}>忘记密码？</button></div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "登录中…" : "登录"}</button>
      </form>
      <p className="form-footnote">还没有账号？ <button className="text-button" type="button" onClick={onRegister}>注册新账号</button></p>
    </AuthCard>
  );
}
