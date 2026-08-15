import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoPlayer, type PlayerController } from "./VideoPlayer";

describe("VideoPlayer", () => {
  it("restores audible element state after an explicit user sound action", () => {
    const ref = createRef<PlayerController>();
    render(<VideoPlayer ref={ref} src="blob:video" title="测试视频" />);
    const video = screen.getByLabelText("测试视频") as HTMLVideoElement;
    video.muted = true;
    video.volume = 0;

    act(() => ref.current?.enableSound());

    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
  });
});
