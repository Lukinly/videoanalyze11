import { useState } from "react";
import type { LinkPreview } from "../api/client";

export function LinkVideo({ availableCredits, previewLink, confirmLink, onConfirmed }: {
  availableCredits?: number;
  previewLink: (url: string) => Promise<LinkPreview>;
  confirmLink: (url: string) => Promise<LinkPreview & { videoId: string }>;
  onConfirmed: (preview: LinkPreview & { videoId: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    setLoading(true); setError(""); setPreview(null);
    try { setPreview(await previewLink(url)); }
    catch (value) { setError(value instanceof Error ? value.message : "无法读取该视频链接"); }
    finally { setLoading(false); }
  }
  async function confirm() {
    if (!preview) return;
    setLoading(true); setError("");
    try { await onConfirmed(await confirmLink(preview.canonicalUrl)); }
    catch (value) { setError(value instanceof Error ? value.message : "确认视频失败，请重试"); }
    finally { setLoading(false); }
  }
  const insufficient = preview && availableCredits !== undefined && preview.estimatedCost > availableCredits;
  return <section className="upload-card link-video-card">
    <label htmlFor="video-link"><span>视频链接</span><input id="video-link" type="url" value={url} placeholder="粘贴 YouTube 或 B站公开视频链接" onChange={(event) => setUrl(event.target.value)} /></label>
    <button className="primary-button" type="button" disabled={loading || !url.trim()} onClick={() => void inspect()}>{loading ? "读取中…" : "读取视频信息"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <div className="link-preview">
      {preview.thumbnailUrl && <img src={preview.thumbnailUrl} alt="" />}
      <div><span className="source-badge">{preview.platform === "youtube" ? "YouTube" : "B站"}</span><h3>{preview.title}</h3><p>{preview.author} · {formatDuration(preview.duration)}</p><strong>预计消耗 {preview.estimatedCost} 积分</strong></div>
      {preview.existingRunId && <a href={`/?run=${encodeURIComponent(preview.existingRunId)}`}>打开已有解析</a>}
      <button className="primary-button" type="button" disabled={loading || Boolean(insufficient) || Boolean(preview.existingRunId && ["queued", "running"].includes(preview.duplicateStatus ?? ""))} onClick={() => void confirm()}>{loading ? "确认中…" : "确认解析"}</button>
      {insufficient && <p className="form-error">积分不足</p>}
    </div>}
  </section>;
}

function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} 小时 ` : ""}${minutes % 60} 分钟`; }
