import type { AnalysisRun } from "../api/client";

export function AnalysisHistory({ items }: { items: AnalysisRun[] }) {
  return <section className="history-card">
    <div className="section-heading"><div><p className="eyebrow">Analysis history</p><h2>最近分析</h2></div></div>
    {items.length === 0 ? <p className="history-empty">还没有分析记录。</p> : <ul className="history-list">
      {items.map((item) => <li key={item.id}>
        <a href={`${item.status === "completed" && item.resultAvailability !== "expired" && item.resultAvailability !== "deleted" ? "/notes" : "/"}?run=${encodeURIComponent(item.id)}`}>
          <span><strong>{item.fileName ?? "未命名视频"}</strong><small>{availabilityLabel(item)}</small></span>
          <span aria-hidden="true">→</span>
        </a>
      </li>)}
    </ul>}
  </section>;
}

function availabilityLabel(run: AnalysisRun) {
  if (run.resultAvailability === "expired") return "隐私结果已到期";
  if (run.resultAvailability === "deleted") return "结果已删除";
  if (run.resultAvailability === "pending") return "分析进行中";
  return run.retentionMode === "privacy" ? "隐私结果 · 完成后保留 24 小时" : "结果可查看";
}
