import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryPanel } from "./SummaryPanel";

describe("SummaryPanel", () => {
  it("renders the one-line and overall summary", () => {
    render(<SummaryPanel oneLineSummary="一句话" overallSummary="整体内容" />);
    expect(screen.getByText("一句话")).toBeVisible();
    expect(screen.getByText("整体内容")).toBeVisible();
  });
});
