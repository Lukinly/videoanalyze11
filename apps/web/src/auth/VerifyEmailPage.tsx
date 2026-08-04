import { useEffect, useState } from "react";
import { api } from "../api/client";

export function VerifyEmailPage({ token, onDone }: { token?: string; onDone: () => void }) {
  const [message, setMessage] = useState("正在验证邮箱…");

  useEffect(() => {
    if (!token) {
      setMessage("验证链接无效或已过期。");
      return;
    }
    void api.verifyEmail(token).then(() => setMessage("邮箱验证成功，现在可以登录并使用 2 次试用分析。"), () => setMessage("验证链接无效或已过期。"));
  }, [token]);

  return <main className="auth-shell"><div className="brand-lockup"><span className="brand-dot" /> videoanalyze</div><section className="auth-card"><p className="eyebrow">Email verification</p><h1>{message}</h1><button className="primary-button" type="button" onClick={onDone}>前往登录</button></section></main>;
}
