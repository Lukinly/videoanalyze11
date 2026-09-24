import { useEffect, useRef, useState } from "react";
import { api, type AnalysisRun } from "../api/client";
import { exportAnalysisMarkdown } from "./export-markdown";

export function ResultActions({ run, onAttach, onDeleted, inspectLocalFile = inspectDuration, allowLocalAttach = true }: {
  run: AnalysisRun;
  onAttach: (url: string, fileName: string) => void;
  onDeleted?: () => void;
  inspectLocalFile?: (file: File, url: string) => Promise<number>;
  allowLocalAttach?: boolean;
}) {
  const localUrl = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (localUrl.current) revokeObjectUrl(localUrl.current); }, []);

  async function attach(file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const duration = await inspectLocalFile(file, url);
      if (run.duration != null && Math.abs(duration - run.duration) > 2 && !window.confirm("视频时长与原文件不一致，仍然使用此文件？")) {
        revokeObjectUrl(url);
        return;
      }
      if (localUrl.current) revokeObjectUrl(localUrl.current);
      localUrl.current = url;
      setError(null);
      onAttach(url, file.name);
    } catch (cause) {
      revokeObjectUrl(url);
      setError(cause instanceof Error ? cause.message : "无法读取本地视频");
    }
  }

  function downloadMarkdown() {
    const url = URL.createObjectURL(new Blob([exportAnalysisMarkdown(run)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName(run.fileName ?? "analysis")}.md`;
    link.click();
    revokeObjectUrl(url);
  }

  async function deleteResults() {
    if (!window.confirm("永久删除逐字稿、摘要和章节？此操作无法撤销。")) return;
    await api.deleteAnalysisResults(run.id);
    onDeleted?.();
  }

  return <div className="result-actions">
    {allowLocalAttach && <label className="secondary-button local-file-button">重新选择本地原视频<input className="visually-hidden" aria-label="重新选择本地原视频" type="file" accept="video/*" onChange={(event) => void attach(event.target.files?.[0])} /></label>}
    {run.resultAvailability === "available" && <button className="secondary-button" type="button" onClick={downloadMarkdown}>导出 Markdown</button>}
    {run.resultAvailability !== "deleted" && <button className="danger-button" type="button" onClick={() => void deleteResults()}>永久删除结果</button>}
    {error && <p className="error-text">{error}</p>}
  </div>;
}

function inspectDuration(_file: File, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => reject(new Error("无法读取本地视频时长"));
    video.src = url;
  });
}

function safeName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "analysis";
}

function revokeObjectUrl(url: string) {
  if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}
