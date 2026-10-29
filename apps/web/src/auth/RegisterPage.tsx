import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { AuthCard } from "./AuthCard";

export function RegisterPage({ onLogin, embedded = false }: { onLogin: () => void; embedded?: boolean }) {
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => setCooldownSeconds((remaining) => Math.max(remaining - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function requestCode() {
    if (!emailInputRef.current?.checkValidity()) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setCodeBusy(true);
    setError(null);
    setCodeMessage(null);
    try {
      const result = await api.sendRegistrationCode({ email: email.trim() });
      setCodeMessage("验证码已发送，请检查邮箱。");
      setCooldownSeconds(Math.max(60, result.expiresInSeconds > 0 ? 60 : 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证码发送失败");
    } finally {
      setCodeBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.register({ email, password, confirmPassword, verificationCode });
      setMessage("注册成功，请返回登录。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard eyebrow="Start with 12 credits" title="创建账号" embedded={embedded}>
      {message ? <div className="success-box"><p>{message}</p><button className="primary-button" type="button" onClick={onLogin}>返回登录</button></div> : <form className="stack-form" onSubmit={submit}>
        <label htmlFor="register-email">邮箱<div className="verification-row"><input ref={emailInputRef} id="register-email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><button className="secondary-button" disabled={codeBusy || cooldownSeconds > 0} type="button" onClick={() => { void requestCode(); }}>{codeBusy ? "发送中…" : cooldownSeconds > 0 ? `${cooldownSeconds} 秒后重试` : "获取验证码"}</button></div></label>
        <label htmlFor="register-code">验证码<input id="register-code" aria-label="验证码" required minLength={6} pattern="[0-9]{6}" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />{codeMessage && <small>{codeMessage}</small>}</label>
        <label htmlFor="register-password">密码<input id="register-password" aria-label="密码" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>至少 8 位字符</small></label>
        <label htmlFor="register-confirm-password">确认密码<input id="register-confirm-password" aria-label="确认密码" required minLength={8} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "创建中…" : "创建账号"}</button>
      </form>}
      {!message && <p className="form-footnote">已有账号？ <button className="text-button" type="button" onClick={onLogin}>返回登录</button></p>}
    </AuthCard>
  );
}
