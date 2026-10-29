import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LinkVideo } from "./LinkVideo";

vi.mock("../player/PlatformVideoPlayer", () => ({ PlatformVideoPlayer: ({ sourceUrl }: { sourceUrl: string }) => <div aria-label="官方播放器预览">{sourceUrl}</div> }));

describe("LinkVideo", () => {
  it("previews the pasted link and requires confirmation before analysis", async () => {
    const preview = vi.fn(async () => ({ videoId: null, existingRunId: null, duplicateStatus: null, platform: "youtube" as const, canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Lesson", author: "Teacher", duration: 600, thumbnailUrl: "", subtitleLanguage: "en", estimatedCost: 10 }));
    const confirmLink = vi.fn(async () => ({ ...(await preview()), videoId: "v1" }));
    const confirm = vi.fn(async () => undefined);
    render(<LinkVideo availableCredits={20} previewLink={preview} confirmLink={confirmLink} onConfirmed={confirm} />);
    await userEvent.type(screen.getByLabelText("视频链接"), "https://youtu.be/dQw4w9WgXcQ");
    await userEvent.click(screen.getByRole("button", { name: "读取视频信息" }));
    expect(await screen.findByText("Lesson")).toBeInTheDocument();
    expect(screen.getByText("预计消耗 10 积分")).toBeInTheDocument();
    expect(screen.getByLabelText("官方播放器预览")).toHaveTextContent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认解析" }));
    expect(confirmLink).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ videoId: "v1" }));
  });
});
