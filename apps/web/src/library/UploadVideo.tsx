import { useEffect, useRef, useState } from "react";
import { api, putUpload } from "../api/client";

export type UploadedVideo = { videoId: string; fileName: string; playbackUrl: string };

export function UploadVideo({ onUploaded }: { onUploaded: (video: UploadedVideo) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (file) URL.revokeObjectURL(URL.createObjectURL(file)); }, [file]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const session = await api.createUploadSession({ fileName: file.name, contentType: file.type || "video/mp4", contentLength: file.size });
      await putUpload(session.uploadUrl, file, setProgress);
      onUploaded({ videoId: session.videoId, fileName: file.name, playbackUrl: URL.createObjectURL(file) });
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
      <div className="upload-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>{file ? file.name : "选择视频"}</button><button className="primary-button" disabled={!file || busy} type="button" onClick={() => void upload()}>{busy ? `上传中 ${Math.round(progress * 100)}%` : "上传并分析"}</button></div>
      {busy && <div className="progress-track compact"><span style={{ width: `${progress * 100}%` }} /></div>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
