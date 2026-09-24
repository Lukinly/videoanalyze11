import { useEffect, useState } from "react";
import { api, type CreditBalance, type CreditLedgerEntry, type CreditTopupRequest } from "../api/client";

export function CreditsPanel({ onChanged }: { onChanged?: () => void } = {}) {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [requests, setRequests] = useState<CreditTopupRequest[]>([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [nextBalance, nextLedger, nextRequests] = await Promise.all([api.getCredits(), api.getCreditLedger(), api.getCreditRequests()]);
      setBalance(nextBalance);
      setLedger(nextLedger.items);
      setRequests(nextRequests.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "积分信息加载失败");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function submit() {
    const requestedAmount = Number(amount);
    if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
      setError("请输入正整数积分");
      return;
    }
    setError(null);
    try {
      await api.createCreditRequest({ requestedAmount, note });
      setAmount("");
      setNote("");
      setMessage("充值申请已提交，等待管理员审核。");
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败");
    }
  }

  return <section className="credit-panel">
    <div className="section-heading"><div><p className="eyebrow">Credits</p><h2>积分余额</h2></div><strong className="credit-balance">{balance ? `${balance.available} 积分` : "加载中…"}</strong></div>
    {balance && <p className="credit-subline">账面余额 {balance.ledgerBalance}，处理中预留 {balance.held}</p>}
    <div className="credit-request-form">
      <label htmlFor="credit-request-amount">充值积分<input id="credit-request-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label htmlFor="credit-request-note">备注<textarea id="credit-request-note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="secondary-button" type="button" onClick={() => void submit()}>提交充值申请</button>
    </div>
    {message && <p className="success-box">{message}</p>}
    {error && <p className="error-text">{error}</p>}
    <div className="credit-history"><h3>充值申请</h3>{requests.length === 0 ? <p className="empty-state">还没有充值申请。</p> : <ul>{requests.map((request) => <li key={request.id}>{request.requestedAmount} 积分 · {request.status}</li>)}</ul>}</div>
    <div className="credit-history"><h3>最近流水</h3>{ledger.length === 0 ? <p className="empty-state">还没有积分流水。</p> : <ul>{ledger.map((entry) => <li key={entry.id}>{entry.amount > 0 ? "+" : ""}{entry.amount} · {entry.reason}</li>)}</ul>}</div>
  </section>;
}
