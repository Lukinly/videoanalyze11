import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { Brand } from "../brand/Brand";

export function ResetPasswordPage({ token, forceChange = false, onDone, onRequestReset, onLogin }: { token?: string; forceChange?: boolean; onDone: () => void; onRequestReset?: () => void; onLogin?: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!forceChange && !token) { setError("重置链接无效"); return; }
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (forceChange) await api.changePassword({ password, confirmPassword });
      else await api.resetPassword({ token: token!, password, confirmPassword });
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "INVALID_RESET_TOKEN") {
        setInvalidToken(true);
        setError("重置链接已失效或已使用，请重新申请。");
      } else setError("密码保存失败，请稍后重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <main className="auth-shell"><Brand /><section className="auth-card"><p className="eyebrow">Password reset</p><h1>设置新密码</h1>{!forceChange && (!token || invalidToken) ? <div className="stack-form">
    <p className="error-text" role="alert">{error ?? "重置链接无效，请重新申请。"}</p>
    {onRequestReset && <button className="primary-button" type="button" onClick={onRequestReset}>重新获取重置链接</button>}
  </div> : <form className="stack-form" onSubmit={submit}>
    <label htmlFor="reset-password">新密码<input id="reset-password" aria-label="新密码" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label htmlFor="reset-confirm-password">确认密码<input id="reset-confirm-password" aria-label="确认密码" required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
    <small>至少 8 位字符</small>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy} type="submit">{busy ? "保存中…" : "保存新密码"}</button>
  </form>}{!forceChange && onLogin && <p className="form-footnote"><button className="text-button" type="button" onClick={onLogin}>返回登录</button></p>}</section></main>;
}
