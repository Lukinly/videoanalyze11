import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisHistory } from "./AnalysisHistory";

describe("analysis history", () => {
  it("links recoverable runs and labels expired privacy results", () => {
    render(<AnalysisHistory items={[
      { id: "r1", videoId: "v1", fileName: "keep.mp4", status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available" },
      { id: "r2", videoId: "v2", fileName: "private.mp4", status: "completed", stage: "completed", retentionMode: "privacy", resultAvailability: "expired" }
    ]} />);
    expect(screen.getByRole("link", { name: /keep.mp4/ })).toHaveAttribute("href", "/notes?run=r1");
    expect(screen.getByText("隐私结果已到期")).toBeVisible();
  });
});
