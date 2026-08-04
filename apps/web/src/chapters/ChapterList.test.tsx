import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChapterList } from "./ChapterList";

describe("ChapterList", () => {
  it("seeks to a chapter's aligned start", async () => {
    const user = userEvent.setup();
    const seek = vi.fn();
    render(<ChapterList chapters={[{ id: "ch1", title: "背景", start: 42, end: 60 }]} onSeek={seek} />);

    await user.click(screen.getByRole("button", { name: /背景/ }));

    expect(seek).toHaveBeenCalledWith(42);
  });
});
