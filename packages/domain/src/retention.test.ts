import { describe, expect, it } from "vitest";

describe("retention domain contracts", () => {
  it("accepts the supported retention modes and rejects unsupported modes", async () => {
    const { retentionModeSchema } = await import("./retention.js");

    expect(retentionModeSchema.parse("standard")).toBe("standard");
    expect(retentionModeSchema.parse("privacy")).toBe("privacy");
    expect(() => retentionModeSchema.parse("forever")).toThrow();
  });
});
