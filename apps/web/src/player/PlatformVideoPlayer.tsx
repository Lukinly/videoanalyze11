import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { parseVideoLink, timestampedVideoUrl, type ParsedVideoLink } from "@videoanalyze/domain";
import type { PlayerController } from "./VideoPlayer";
import { loadYouTubeApi, type YouTubePlayer } from "./youtube-api";

type PlayerStatus = { kind: "loading" | "ready" | "error"; message?: string };
type PlatformPlayerProps = { sourceUrl?: string | null; title?: string; onTimeUpdate?: (seconds: number) => void };

export const PlatformVideoPlayer = forwardRef<PlayerController, PlatformPlayerProps>(function PlatformVideoPlayer({ sourceUrl, title = "平台视频", onTimeUpdate }, ref) {
  const source = useMemo(() => parseVideoLink(sourceUrl ?? ""), [sourceUrl]);
  if (!source) return <div className="video-frame platform-invalid"><p>无法识别原视频链接，请重新导入视频。</p></div>;
  return <PlatformPlayer key={source.canonicalUrl} ref={ref} source={source} title={title} onTimeUpdate={onTimeUpdate} />;
});

const PlatformPlayer = forwardRef<PlayerController, { source: ParsedVideoLink; title: string; onTimeUpdate?: (seconds: number) => void }>(function PlatformPlayer({ source, title, onTimeUpdate }, ref) {
  const [status, setStatus] = useState<PlayerStatus>({ kind: "loading" });
  const [seconds, setSeconds] = useState(0);
  const reportTime = useCallback((time: number) => {
    if (!Number.isFinite(time) || time < 0) return;
    setSeconds(Math.floor(time));
    onTimeUpdate?.(time);
  }, [onTimeUpdate]);
  return <section className="platform-player" aria-label="原站播放器">
    <div className="video-frame platform-frame">
      {source.platform === "youtube"
        ? <YouTubeEmbed ref={ref} videoId={source.externalId} title={title} onTimeUpdate={reportTime} onStatus={setStatus} />
        : <BilibiliEmbed ref={ref} source={source} title={title} onTimeUpdate={reportTime} onStatus={setStatus} />}
      {source.platform === "youtube" && status.kind !== "ready" && <div className={`platform-player-status${status.kind === "error" ? " is-error" : ""}`} role="status"><span aria-hidden="true">{status.kind === "error" ? "▷" : "◌"}</span><p>{status.kind === "error" ? status.message ?? "播放器暂时无法加载，可打开原视频继续观看。" : "正在加载官方播放器…"}</p></div>}
    </div>
    <div className="platform-player-footer"><span role={source.platform === "bilibili" && status.kind === "error" ? "status" : undefined}>{source.platform === "bilibili" && status.kind === "error" ? status.message : `${source.platform === "youtube" ? "YouTube" : "B站"} 官方播放器 · 清晰度由原站提供`}</span><a href={timestampedVideoUrl(source.canonicalUrl, seconds)} target="_blank" rel="noopener noreferrer">打开原视频 <span aria-hidden="true">↗</span></a></div>
  </section>;
});

const YouTubeEmbed = forwardRef<PlayerController, { videoId: string; title: string; onTimeUpdate: (seconds: number) => void; onStatus: (status: PlayerStatus) => void }>(function YouTubeEmbed({ videoId, title, onTimeUpdate, onStatus }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const ready = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const reportTime = useRef(onTimeUpdate);
  reportTime.current = onTimeUpdate;

  useImperativeHandle(ref, () => ({
    seek(seconds) {
      const time = safeTime(seconds);
      pendingSeek.current = time;
      if (ready.current) {
        player.current?.seekTo(time, true);
        pendingSeek.current = null;
      }
      reportTime.current(time);
    },
    enableSound() { if (ready.current) { player.current?.unMute(); player.current?.setVolume(100); } },
    getCurrentTime: () => ready.current ? player.current?.getCurrentTime() ?? 0 : pendingSeek.current ?? 0,
    getPaused: () => !ready.current || player.current?.getPlayerState() !== 1
  }), []);

  useEffect(() => {
    let active = true;
    let instance: YouTubePlayer | undefined;
    let poll: number | undefined;
    const mount = mountRef.current!;
    ready.current = false;
    onStatus({ kind: "loading" });
    const timeout = window.setTimeout(() => { if (active && !ready.current) onStatus({ kind: "error", message: "播放器加载较慢，可打开原视频继续观看。" }); }, 15_000);
    void loadYouTubeApi().then((api) => {
      if (!active) return;
      const target = document.createElement("div");
      mount.replaceChildren(target);
      instance = new api.Player(target, { videoId, width: "100%", height: "100%", playerVars: { origin: window.location.origin, playsinline: 1, autoplay: 0, rel: 0 }, events: {
        onReady(event) {
          if (!active) return;
          player.current = event.target;
          ready.current = true;
          window.clearTimeout(timeout);
          onStatus({ kind: "ready" });
          if (pendingSeek.current !== null) {
            event.target.seekTo(pendingSeek.current, true);
            pendingSeek.current = null;
          }
          poll = window.setInterval(() => {
            if (!active || !ready.current) return;
            reportTime.current(event.target.getCurrentTime());
          }, 500);
        },
        onError(event) {
          if (!active) return;
          ready.current = false;
          window.clearInterval(poll);
          window.clearTimeout(timeout);
          onStatus({ kind: "error", message: [101, 150].includes(event.data) ? "该视频不允许站外播放，请打开原视频观看。" : "此视频暂时无法在页面内播放，请打开原视频观看。" });
        }
      } });
      player.current = instance;
      const frame = instance.getIframe();
      frame.title = `${title}（YouTube 官方播放器）`;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
    }).catch(() => { if (active) { window.clearTimeout(timeout); onStatus({ kind: "error", message: "YouTube 播放器暂时无法加载，可打开原视频继续观看。" }); } });
    return () => {
      active = false;
      ready.current = false;
      player.current = null;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      instance?.destroy();
      mount.replaceChildren();
    };
  }, [videoId, title, onStatus]);

  return <div className="platform-youtube-mount" ref={mountRef} />;
});

const BilibiliEmbed = forwardRef<PlayerController, { source: ParsedVideoLink; title: string; onTimeUpdate: (seconds: number) => void; onStatus: (status: PlayerStatus) => void }>(function BilibiliEmbed({ source, title, onTimeUpdate, onStatus }, ref) {
  const [position, setPosition] = useState({ seconds: 0, revision: 0 });
  const lastSeek = useRef(0);
  const loadTimer = useRef<number | undefined>(undefined);
  const settledRevision = useRef(-1);
  const reportTime = useRef(onTimeUpdate);
  reportTime.current = onTimeUpdate;
  useImperativeHandle(ref, () => ({
    seek(seconds) {
      const time = safeTime(seconds);
      lastSeek.current = time;
      onStatus({ kind: "loading" });
      setPosition((previous) => ({ seconds: time, revision: previous.revision + 1 }));
      reportTime.current(time);
    },
    enableSound() { /* Sound is controlled inside the official cross-origin player. */ },
    // The documented Bilibili embed exposes initial time, not a progress API.
    getCurrentTime: () => lastSeek.current,
    getPaused: () => true
  }), [onStatus]);
  useEffect(() => {
    if (settledRevision.current === position.revision) return;
    loadTimer.current = window.setTimeout(() => onStatus({ kind: "error", message: "B站播放器加载较慢，可打开原视频继续观看。" }), 15_000);
    return () => window.clearTimeout(loadTimer.current);
  }, [position.revision, onStatus]);
  const url = new URL("https://player.bilibili.com/player.html");
  url.searchParams.set("bvid", source.externalId);
  url.searchParams.set("p", String(source.part ?? 1));
  url.searchParams.set("autoplay", position.revision > 0 ? "1" : "0");
  url.searchParams.set("danmaku", "0");
  url.searchParams.set("t", String(position.seconds));
  return <iframe key={position.revision} src={url.toString()} title={`${title}（B站官方播放器）`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => { settledRevision.current = position.revision; window.clearTimeout(loadTimer.current); onStatus({ kind: "ready" }); }} onError={() => { settledRevision.current = position.revision; window.clearTimeout(loadTimer.current); onStatus({ kind: "error", message: "B站播放器暂时无法加载，可打开原视频继续观看。" }); }} />;
});

function safeTime(seconds: number) {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}
