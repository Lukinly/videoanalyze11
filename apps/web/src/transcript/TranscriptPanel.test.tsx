import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TranscriptPanel } from "./TranscriptPanel";

describe("TranscriptPanel", () => {
  it("seeks to a transcript segment without changing paused state", async () => {
    const user = userEvent.setup();
    const seek = vi.fn();

    render(
      <TranscriptPanel
        segments={[{ id: "s1", runId: "run_1", start: 12.5, end: 20, text: "内容" }]}
        onSeek={seek}
      />
    );

    await user.click(screen.getByRole("button", { name: "00:12 内容" }));

    expect(seek).toHaveBeenCalledWith(12.5);
  });
});
