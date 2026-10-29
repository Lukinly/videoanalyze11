// Use one independent decoder so extracting stills never seeks the visible player.
export async function captureVideoFrames(src: string, timestamps: number[], onFrame: (seconds: number, dataUrl: string) => void, signal: AbortSignal) {
  signal.throwIfAborted();
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法提取视频画面");
  try {
    const loaded = waitForMedia(video, "loadeddata", signal);
    video.src = src;
    video.load();
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new Error("视频没有可用画面");
    canvas.width = Math.min(960, video.videoWidth);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    for (const seconds of [...new Set(timestamps)].sort((a, b) => a - b)) {
      signal.throwIfAborted();
      if (seconds < 0 || seconds >= video.duration) continue;
      if (Math.abs(video.currentTime - seconds) > 0.001) {
        const seeked = waitForMedia(video, "seeked", signal);
        video.currentTime = seconds;
        await seeked;
        signal.throwIfAborted();
        if (Math.abs(video.currentTime - seconds) > 0.1) throw new Error("原视频不支持定位到此时间点");
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      onFrame(seconds, canvas.toDataURL("image/jpeg", 0.8));
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    canvas.width = 0;
    canvas.height = 0;
  }
}

function waitForMedia(video: HTMLVideoElement, event: "loadeddata" | "seeked", signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("无法读取视频画面"));
    const aborted = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("读取视频画面超时")), 15_000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
