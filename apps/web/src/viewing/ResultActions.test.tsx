import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AnalysisRun } from "../api/client";
import { ResultActions } from "./ResultActions";

const run: AnalysisRun = { id: "r1", videoId: "v1", fileName: "demo.mp4", duration: 120, status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available", transcript: { mergeWarnings: [], segments: [] } };

describe("result actions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reattaches a matching local video without uploading or charging", async () => {
    const attach = vi.fn();
    vi.spyOn(api, "createUploadSession");
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn().mockReturnValue("blob:local"), revokeObjectURL: vi.fn() });
    render(<ResultActions run={run} onAttach={attach} inspectLocalFile={vi.fn().mockResolvedValue(121)} />);

    await userEvent.upload(screen.getByLabelText("重新选择本地原视频"), new File(["x"], "demo.mp4", { type: "video/mp4" }));

    expect(attach).toHaveBeenCalledWith("blob:local", "demo.mp4");
    expect(api.createUploadSession).not.toHaveBeenCalled();
  });

  it("confirms and permanently deletes result content", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(api, "deleteAnalysisResults").mockResolvedValue(undefined);
    const deleted = vi.fn();
    render(<ResultActions run={run} onAttach={vi.fn()} onDeleted={deleted} />);

    await userEvent.click(screen.getByRole("button", { name: "永久删除结果" }));

    expect(api.deleteAnalysisResults).toHaveBeenCalledWith("r1");
    expect(deleted).toHaveBeenCalled();
  });
});
