import { useEffect, useState } from "react";
import { api, type AdminUser, type CreditTopupRequest } from "../api/client";

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<CreditTopupRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

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
    {error && <p className="error-text">{error}</p>}
    <section className="admin-card"><div className="section-heading"><h2>用户</h2><span className="count-badge">{users.length}</span></div><ul className="admin-list">{users.map((user) => <li key={user.id}><div><strong>{user.email}</strong><small>{user.role} · {user.status} · {user.available} 积分可用</small></div><button className="secondary-button" type="button" onClick={() => setSelectedUser(user)}>调整积分</button></li>)}</ul></section>
    {selectedUser && <section className="admin-card"><h2>调整 {selectedUser.email} 的积分</h2><label htmlFor="admin-credit-amount">积分<input id="admin-credit-amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label htmlFor="admin-credit-reason">原因<input id="admin-credit-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="upload-actions"><button className="primary-button" type="button" onClick={() => void adjust("grant")}>增加</button><button className="secondary-button" type="button" onClick={() => void adjust("debit")}>扣除</button></div></section>}
    <section className="admin-card"><div className="section-heading"><h2>充值申请</h2><span className="count-badge">{requests.length}</span></div><ul className="admin-list">{requests.map((request) => <li key={request.id}><div><strong>{request.userEmail || "未知用户"}</strong><small>用户 ID：{request.userId || "未知"}</small><small>申请时间：{formatRequestTime(request.createdAt)}</small><small>申请金额：{request.requestedAmount} 积分</small><small>备注：{request.note || "无备注"}</small></div><div className="upload-actions"><button className="primary-button" type="button" onClick={() => void review(request, true)}>通过</button><button className="secondary-button" type="button" onClick={() => void review(request, false)}>拒绝</button></div></li>)}</ul></section>
  </main>;
}

function formatRequestTime(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN");
}
