import { useEffect, useRef, useState } from "react";
import { api, putUpload } from "../api/client";
import type { RetentionMode } from "@videoanalyze/domain";

export type UploadedVideo = { videoId: string; fileName: string; playbackUrl: string; fileSize: number; estimatedCost: number; retentionMode: RetentionMode };

export function UploadVideo({ onUploaded, availableCredits }: { onUploaded: (video: UploadedVideo) => void; availableCredits?: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<RetentionMode>("standard");

  useEffect(() => () => { if (file) URL.revokeObjectURL(URL.createObjectURL(file)); }, [file]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const estimatedCost = Math.max(1, Math.ceil(file.size / 10_000_000));
      if (availableCredits !== undefined && availableCredits < estimatedCost) throw new Error(`余额不足：需要 ${estimatedCost} 积分，当前可用 ${availableCredits} 积分`);
      const session = await api.createUploadSession({ fileName: file.name, contentType: file.type || "video/mp4", contentLength: file.size });
      await putUpload(session.uploadUrl, file, setProgress);
      onUploaded({ videoId: session.videoId, fileName: file.name, playbackUrl: URL.createObjectURL(file), fileSize: session.fileSize, estimatedCost: session.estimatedCost, retentionMode });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload-card">
      <div className="upload-copy"><p className="eyebrow">New analysis</p><h2>把视频交给工作台</h2><p>先从 H.264/AAC MP4 开始，浏览器播放和 V0 逐字稿体验最稳定。</p></div>
      <input ref={inputRef} className="visually-hidden" type="file" accept="video/mp4,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <fieldset className="retention-options"><legend>结果保留方式</legend><label><input type="radio" name="retention" checked={retentionMode === "standard"} onChange={() => setRetentionMode("standard")} /> 标准：文字结果长期保留</label><label><input type="radio" name="retention" checked={retentionMode === "privacy"} onChange={() => setRetentionMode("privacy")} /> 隐私：完成后 24 小时自动删除文字结果</label></fieldset>
      <p className="retention-copy">分析进入后台后，离开或刷新页面不会取消任务；原视频、音频和切片在任务终态后会从服务器删除。</p>
      <div className="upload-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>{file ? file.name : "选择视频"}</button><button className="primary-button" disabled={!file || busy} type="button" onClick={() => void upload()}>{busy ? `上传中 ${Math.round(progress * 100)}%` : "上传并分析"}</button></div>
      {file && <p className="credit-hint">预计消耗 {Math.max(1, Math.ceil(file.size / 10_000_000))} 积分</p>}
      {busy && <div className="progress-track compact"><span style={{ width: `${progress * 100}%` }} /></div>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
