import type { AnalysisRun } from "../api/client";

export function exportAnalysisMarkdown(run: Pick<AnalysisRun, "fileName" | "summary" | "transcript">): string {
  const lines = [`# ${run.fileName ?? "视频分析"}`, ""];
  if (run.summary) {
    lines.push(run.summary.oneLineSummary, "", run.summary.overallSummary, "");
    for (const chapter of run.summary.chapters) {
      lines.push(`## ${chapter.title} · ${formatTime(chapter.start ?? 0)}`, "", chapter.summary);
      for (const bullet of chapter.bullets) lines.push(`- ${bullet.text}`);
      lines.push("");
    }
  }
  if (run.transcript?.segments.length) {
    lines.push("## 逐字稿", "");
    for (const segment of run.transcript.segments) lines.push(`- ${formatTime(segment.start)} ${segment.text}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours ? [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":") : [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}
