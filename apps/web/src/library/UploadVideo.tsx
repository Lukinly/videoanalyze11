import { useRef, useState } from "react";
import { api, putUpload } from "../api/client";
import type { RetentionMode } from "@videoanalyze/domain";

export type UploadedVideo = { videoId: string; fileName: string; playbackUrl: string; fileSize: number; estimatedCost?: number; retentionMode: RetentionMode; sourcePlatform?: "upload" | "youtube" | "bilibili"; sourceUrl?: string | null; sourceAuthor?: string | null; thumbnailUrl?: string | null };

export function UploadVideo({ onUploaded, onRequireLogin }: { onUploaded: (video: UploadedVideo) => void | Promise<void>; availableCredits?: number; onRequireLogin?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<RetentionMode>("standard");

  async function upload() {
    if (!file) return;
    if (onRequireLogin) { onRequireLogin(); return; }
    setBusy(true);
    setError(null);
    setProgress(0);
    let playbackUrl: string | undefined;
    try {
      const session = await api.createUploadSession({ fileName: file.name, contentType: file.type || "video/mp4", contentLength: file.size });
      await putUpload(session.uploadUrl, file, setProgress);
      playbackUrl = URL.createObjectURL(file);
      await onUploaded({ videoId: session.videoId, fileName: file.name, playbackUrl, fileSize: session.fileSize, retentionMode });
    } catch (cause) {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload-card">
      <div className="upload-copy"><p className="eyebrow">New analysis</p><h2>把视频交给工作台</h2><p>选择一段课程、讲座或分享视频，生成逐字稿与详细笔记。</p></div>
      <input ref={inputRef} aria-label="选择用于分析的视频" className="visually-hidden" type="file" accept="video/mp4,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <fieldset className="retention-options"><legend>结果保留方式</legend><label><input type="radio" name="retention" checked={retentionMode === "standard"} onChange={() => setRetentionMode("standard")} /> 标准：文字结果长期保留</label><label><input type="radio" name="retention" checked={retentionMode === "privacy"} onChange={() => setRetentionMode("privacy")} /> 隐私：完成后 24 小时自动删除文字结果</label></fieldset>
      <p className="retention-copy">分析进入后台后，离开或刷新页面不会取消任务；原视频、音频和切片在任务终态后会从服务器删除。</p>
      <p className="retention-copy">费用由服务器读取真实时长后按阶梯计费；文件大小不参与扣费，最长支持 4 小时。</p>
      <div className="upload-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>{file ? file.name : "选择视频"}</button><button className="primary-button" disabled={!file || busy} type="button" onClick={() => void upload()}>{busy ? `上传中 ${Math.round(progress * 100)}%` : "上传并分析"}</button></div>
      {file && <p className="credit-hint">上传后将按服务器探测到的真实时长确认积分</p>}
      {busy && <div className="progress-track compact"><span style={{ width: `${progress * 100}%` }} /></div>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
