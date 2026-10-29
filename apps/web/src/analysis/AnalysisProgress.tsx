import { useEffect, useRef, useState } from "react";
import { api, subscribeToAnalysis, type AnalysisRun } from "../api/client";

type AnalysisProgressProps = {
  runId?: string;
  onCompleted?: (run: AnalysisRun) => void;
};

export function AnalysisProgress({ runId, onCompleted }: AnalysisProgressProps) {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState("未开始");

  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setConnectionState("未开始");
      return;
    }

    let disposed = false;
    let pollingStopped = false;
    let refreshing = false;
    let completed = false;
    let unsubscribe: () => void = () => undefined;
    setRun(null);
    setCancelError(null);
    setCancelBusy(false);

    const refresh = async () => {
      if (refreshing || disposed) return;
      refreshing = true;
      try {
        const current = await api.getAnalysis(runId);
        if (disposed) return;
        setRun(current);
        if (["completed", "failed", "cancelled"].includes(current.status)) {
          pollingStopped = true;
          unsubscribe();
          setConnectionState("任务已结束");
        }
        if (current.status === "completed" && !completed) {
          completed = true;
          onCompletedRef.current?.(current);
        }
      } catch {
        if (!disposed) setConnectionState("无法读取任务状态");
      } finally {
        refreshing = false;
      }
    };

    setConnectionState("实时连接中");
    unsubscribe = subscribeToAnalysis(runId, (event) => {
      if (disposed || pollingStopped) return;
      setConnectionState("实时连接已连接");
      setRun((current) => ({
        ...(current ?? { id: runId, status: "running", videoId: "", stage: "queued" }),
        ...event
      }));
      // Load the complete persisted result before notifying the workspace.
      if (["completed", "failed", "cancelled"].includes(event.status ?? event.stage ?? "")) void refresh();
    }, () => {
      if (!disposed && !pollingStopped) setConnectionState("实时连接断开，正在重连");
      // EventSource reconnects automatically; a second connection leaks streams.
    });
    void refresh();
    const pollTimer = setInterval(() => { if (!pollingStopped) void refresh(); }, 1000);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(pollTimer);
    };
  }, [runId]);

  if (!runId) {
    return <section className="progress-card"><p className="eyebrow">分析队列</p><p>上传视频后开始分析。</p></section>;
  }

  async function cancel() {
    if (!runId) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const current = await api.cancelAnalysis(runId);
      setRun(current);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "取消失败，请稍后重试");
    } finally { setCancelBusy(false); }
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
        <div className="progress-actions">
          <span className={`status-pill status-${run?.status ?? "queued"}`}>{statusLabel(run?.status ?? "queued")}</span>
          {!["completed", "failed", "cancelled", "cancelling"].includes(run?.status ?? "queued") && <button className="text-button" type="button" disabled={cancelBusy} onClick={() => { void cancel(); }}>{cancelBusy ? "取消中…" : "取消任务"}</button>}
        </div>
      </div>
      <div className="progress-track"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="progress-meta"><span>{Math.round(progress * 100)}%</span><span>{chunkText}</span></div>
      <p className="connection-state">{connectionState}</p>
      {cancelError && <p className="error-text">{cancelError}</p>}
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
    generating_notes: "生成 AI 笔记",
    indexing: "建立索引",
    completed: "分析完成"
  };
  return labels[stage] ?? stage;
}

function statusLabel(status: string) {
  return ({ queued: "排队中", running: "处理中", cancelling: "取消中", cancelled: "已取消", completed: "已完成", failed: "失败" } as Record<string, string>)[status] ?? status;
}
