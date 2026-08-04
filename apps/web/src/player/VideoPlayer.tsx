import { forwardRef, useImperativeHandle, useRef } from "react";

export type PlayerController = {
  seek(seconds: number): void;
  getCurrentTime(): number;
  getPaused(): boolean;
};

type VideoPlayerProps = {
  src?: string;
  title?: string;
  onTimeUpdate?: (seconds: number) => void;
};

export const VideoPlayer = forwardRef<PlayerController, VideoPlayerProps>(function VideoPlayer({ src, title = "视频播放器", onTimeUpdate }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      if (videoRef.current) videoRef.current.currentTime = Math.max(0, seconds);
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getPaused: () => videoRef.current?.paused ?? true
  }), []);

  return (
    <div className="video-frame">
      {src ? (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={src}
          aria-label={title}
          onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget.currentTime)}
        />
      ) : (
        <div className="video-placeholder" role="img" aria-label="等待上传视频">
          <span className="play-mark">▶</span>
          <p>上传视频后在这里播放</p>
        </div>
      )}
    </div>
  );
});
