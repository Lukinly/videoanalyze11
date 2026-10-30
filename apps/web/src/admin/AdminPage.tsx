import { useEffect, useRef, useState, type FormEvent } from "react";
import { WELCOME_CREDITS } from "@videoanalyze/domain";
import { api, type AdminUser, type CreditTopupRequest } from "../api/client";

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<CreditTopupRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const [userResult, requestResult] = await Promise.all([api.listAdminUsers(), api.listAdminCreditRequests()]);
      setUsers(userResult.items);
      setRequests(requestResult.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员数据加载失败");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function adjust(direction: "grant" | "debit") {
    if (!selectedUser) return;
    const parsedAmount = Number(amount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0 || !reason.trim()) { setError("请输入正整数积分和原因"); return; }
    try {
      await api.adjustAdminCredits(selectedUser.id, { direction, amount: parsedAmount, reason, idempotencyKey: `${selectedUser.id}:${Date.now()}` });
      setAmount(""); setReason(""); setSelectedUser(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "积分调整失败"); }
  }

  async function review(request: CreditTopupRequest, approve: boolean) {
    try {
      if (approve) await api.approveAdminTopup(request.id, "管理员已核验充值");
      else await api.rejectAdminTopup(request.id, "充值信息未通过核验");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审核失败"); }
  }

  return <main className="admin-shell"><header className="section-heading"><div><p className="eyebrow">Administration</p><h1>管理员后台</h1></div></header>
    {error && <p className="error-text" role="alert">{error}</p>}
    {message && <p className="success-box" role="status">{message}</p>}
    <section className="admin-card"><div className="section-heading"><h2>用户 <span className="count-badge">{users.length}</span></h2><button className="primary-button" type="button" disabled={showCreateUser} onClick={() => { setError(null); setMessage(null); setShowCreateUser(true); }}>新增普通账号</button></div>
      {showCreateUser && <CreateUserForm onCancel={() => setShowCreateUser(false)} onCreated={(user) => {
        setUsers((current) => [user, ...current.filter((item) => item.id !== user.id)]);
        setShowCreateUser(false);
        setMessage(`已创建 ${user.email}，请将初始密码通过安全方式交给用户。用户首次登录时需设置新密码。`);
      }} />}
      <ul className="admin-list">{users.map((user) => <li key={user.id}><div><strong>{user.email}</strong><small>{user.role} · {user.status} · {user.available} 积分可用{user.mustChangePassword ? " · 待修改初始密码" : ""}</small></div><button className="secondary-button" type="button" onClick={() => setSelectedUser(user)}>调整积分</button></li>)}</ul></section>
    {selectedUser && <section className="admin-card"><h2>调整 {selectedUser.email} 的积分</h2><label htmlFor="admin-credit-amount">积分<input id="admin-credit-amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label htmlFor="admin-credit-reason">原因<input id="admin-credit-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="upload-actions"><button className="primary-button" type="button" onClick={() => void adjust("grant")}>增加</button><button className="secondary-button" type="button" onClick={() => void adjust("debit")}>扣除</button></div></section>}
    <section className="admin-card"><div className="section-heading"><h2>充值申请</h2><span className="count-badge">{requests.length}</span></div><ul className="admin-list">{requests.map((request) => <li key={request.id}><div><strong>{request.userEmail || "未知用户"}</strong><small>用户 ID：{request.userId || "未知"}</small><small>申请时间：{formatRequestTime(request.createdAt)}</small><small>申请金额：{request.requestedAmount} 积分</small><small>备注：{request.note || "无备注"}</small></div><div className="upload-actions"><button className="primary-button" type="button" onClick={() => void review(request, true)}>通过</button><button className="secondary-button" type="button" onClick={() => void review(request, false)}>拒绝</button></div></li>)}</ul></section>
  </main>;
}

function CreateUserForm({ onCreated, onCancel }: { onCreated: (user: AdminUser) => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createAdminUser({ email: email.trim(), password, confirmPassword, reason: reason.trim() });
      setPassword("");
      setConfirmPassword("");
      onCreated({ ...result.user, ledgerBalance: result.welcomeCredits, held: 0, available: result.welcomeCredits });
    } catch (cause) {
      setPassword("");
      setConfirmPassword("");
      setError(cause instanceof Error ? cause.message : "账号创建失败，请稍后重试");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form className="admin-create-form" aria-label="新增普通账号" onSubmit={submit}>
    <p>请确认邮箱归属后创建。此账号无需验证码，首次登录时需设置新密码，默认赠送 {WELCOME_CREDITS} 积分。</p>
    <fieldset disabled={busy}>
      <label htmlFor="admin-new-email">邮箱<input id="admin-new-email" required type="email" maxLength={320} autoComplete="off" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label htmlFor="admin-new-password">初始密码<input id="admin-new-password" required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label htmlFor="admin-new-confirm-password">确认初始密码<input id="admin-new-confirm-password" required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      <label htmlFor="admin-new-reason">创建原因（选填）<input id="admin-new-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    </fieldset>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="upload-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "创建中…" : "创建账号"}</button><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>取消</button></div>
  </form>;
}

function formatRequestTime(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN");
}
