import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlayerController } from "../player/VideoPlayer";
import { NotesPage } from "./NotesPage";

describe("NotesPage", () => {
  it("shows detailed notes and seeks from a citation", () => {
    const playerRef = createRef<PlayerController>();
    playerRef.current = { seek: vi.fn(), enableSound: vi.fn(), getCurrentTime: vi.fn(() => 0), getPaused: vi.fn(() => true) };
    render(<NotesPage run={{ id: "r1", videoId: "v1", fileName: "lesson.mp4", status: "completed", stage: "completed", notes: { title: "课程笔记", topic: "主题", coreIdeas: ["观点"], sections: [{ id: "s1", level: 1, title: "概念", body: "详细解释", citations: [{ segmentId: "seg", timestampSeconds: 75 }] }], reviewPoints: ["复习"] } }} playbackUrl="blob:video" playerRef={playerRef} onAttach={vi.fn()} />);

    const seek = vi.fn();
    playerRef.current.seek = seek;
    expect(screen.getByRole("heading", { name: "课程笔记" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /01:15/ }));
    expect(seek).toHaveBeenCalledWith(75);
  });
});
