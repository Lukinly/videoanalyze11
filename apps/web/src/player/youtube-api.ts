export type YouTubePlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  unMute(): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

export type YouTubeApi = {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    width: string;
    height: string;
    playerVars: { origin: string; playsinline: number; autoplay: number; rel: number };
    events: {
      onReady(event: { target: YouTubePlayer }): void;
      onError(event: { data: number }): void;
    };
  }) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YouTubeApi> | undefined;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.removeEventListener("error", failed);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previousReady;
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("YouTube 播放器暂时无法加载"));
    };
    const ready = () => {
      cleanup();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube 播放器暂时无法加载"));
      previousReady?.();
    };
    const timer = window.setTimeout(failed, 12_000);
    window.onYouTubeIframeAPIReady = ready;
    script.addEventListener("error", failed, { once: true });
    document.head.append(script);
  }).catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}
