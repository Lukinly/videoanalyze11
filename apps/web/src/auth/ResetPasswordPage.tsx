import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { Brand } from "../brand/Brand";

export function ResetPasswordPage({ token, forceChange = false, onDone }: { token?: string; forceChange?: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!forceChange && !token) { setError("重置链接无效"); return; }
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    setError(null);
    try {
      if (forceChange) await api.changePassword({ password, confirmPassword });
      else await api.resetPassword({ token: token!, password, confirmPassword });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码重置失败");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><Brand /><section className="auth-card"><p className="eyebrow">Password reset</p><h1>设置新密码</h1><form className="stack-form" onSubmit={submit}>
    <label htmlFor="reset-password">新密码<input id="reset-password" aria-label="新密码" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label htmlFor="reset-confirm-password">确认密码<input id="reset-confirm-password" aria-label="确认密码" required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
    {error && <p className="error-text">{error}</p>}
    <button className="primary-button" disabled={busy} type="submit">{busy ? "保存中…" : "保存新密码"}</button>
  </form></section></main>;
}
