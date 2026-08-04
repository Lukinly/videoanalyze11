export function SummaryPanel({ oneLineSummary, overallSummary }: { oneLineSummary?: string; overallSummary?: string }) {
  return <section className="summary-panel" aria-labelledby="summary-heading">
    <p className="eyebrow">AI summary</p>
    <h2 id="summary-heading">{oneLineSummary || "等待摘要"}</h2>
    <p>{overallSummary || "分析完成后，摘要会出现在这里。"}</p>
  </section>;
}
