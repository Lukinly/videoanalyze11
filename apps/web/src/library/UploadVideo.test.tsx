import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadVideo } from "./UploadVideo";

describe("upload retention choices", () => {
  it("explains leave-page behavior, terminal media deletion, and privacy expiry", () => {
    render(<UploadVideo onUploaded={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /标准/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /隐私.*24 小时/ })).toBeVisible();
    expect(screen.getByText(/离开或刷新页面不会取消任务/)).toBeVisible();
    expect(screen.getByText(/原视频、音频和切片.*删除/)).toBeVisible();
    expect(screen.getByText(/服务器读取真实时长.*阶梯计费/)).toBeVisible();
  });
});
