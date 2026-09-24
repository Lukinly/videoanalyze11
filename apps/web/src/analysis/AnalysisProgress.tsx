import { useEffect, useState } from "react";
import { api, subscribeToAnalysis, type AnalysisRun } from "../api/client";

type AnalysisProgressProps = {
  runId?: string;
  onCompleted?: (run: AnalysisRun) => void;
};

export function AnalysisProgress({ runId, onCompleted }: AnalysisProgressProps) {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [connectionState, setConnectionState] = useState("未开始");

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setConnectionState("未开始");
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollingStopped = false;
    let unsubscribe: () => void = () => undefined;

    const refresh = async () => {
      try {
        const current = await api.getAnalysis(runId);
        if (disposed) return;
        setRun(current);
        if (current.status === "completed") onCompleted?.(current);
        if (["completed", "failed", "cancelled"].includes(current.status)) {
          pollingStopped = true;
        }
      } catch {
        if (!disposed) setConnectionState("无法读取任务状态");
      }
    };

    const connect = () => {
      if (disposed) return;
      setConnectionState("实时连接中");
      unsubscribe = subscribeToAnalysis(runId, (event) => {
        if (disposed) return;
        setRun((current) => ({
          ...(current ?? { id: runId, status: "running", videoId: "", stage: "queued" }),
          ...event
        }));
        if (event.stage === "completed") onCompleted?.({ ...(run ?? { id: runId, status: "completed", videoId: "", stage: "completed" }), ...event } as AnalysisRun);
      }, () => {
        setConnectionState("实时连接断开，正在重连");
        reconnectTimer = setTimeout(connect, 1500);
      });
    };

    void refresh();
    const pollTimer = setInterval(() => { if (!pollingStopped) void refresh(); }, 1000);
    connect();
    return () => {
      disposed = true;
      unsubscribe();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [onCompleted, runId]);

  if (!runId) {
    return <section className="progress-card"><p className="eyebrow">分析队列</p><p>上传视频后开始分析。</p></section>;
  }

  const progress = Math.min(1, Math.max(0, run?.progress ?? 0));
  const chunkText = run?.totalChunks ? `${run.completedChunks ?? 0} / ${run.totalChunks} 音频块` : "准备音频处理";
  return (
    <section className="progress-card" aria-live="polite">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Analysis run</p>
          <h2>{stageLabel(run?.stage ?? "queued")}</h2>
        </div>
        <span className={`status-pill status-${run?.status ?? "queued"}`}>{statusLabel(run?.status ?? "queued")}</span>
      </div>
      <div className="progress-track"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="progress-meta"><span>{Math.round(progress * 100)}%</span><span>{chunkText}</span></div>
      <p className="connection-state">{connectionState}</p>
      {run?.status === "failed" && <p className="error-text">分析失败，请稍后重试。</p>}
    </section>
  );
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "等待处理",
    probing: "读取媒体信息",
    extracting_audio: "提取音频",
    chunking: "切分音频",
    transcribing: "生成逐字稿",
    merging_transcript: "合并逐字稿",
    summarizing: "生成摘要",
    indexing: "建立索引",
    completed: "分析完成"
  };
  return labels[stage] ?? stage;
}

function statusLabel(status: string) {
  return ({ queued: "排队中", running: "处理中", cancelling: "取消中", cancelled: "已取消", completed: "已完成", failed: "失败" } as Record<string, string>)[status] ?? status;
}
