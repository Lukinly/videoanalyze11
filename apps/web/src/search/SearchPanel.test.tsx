import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchPanel } from "./SearchPanel";

describe("SearchPanel", () => {
  it("renders an empty search state", () => {
    render(<SearchPanel runId="r1" onSeek={() => undefined} />);
    expect(screen.getByRole("searchbox", { name: "搜索逐字稿" })).toBeVisible();
  });
});
