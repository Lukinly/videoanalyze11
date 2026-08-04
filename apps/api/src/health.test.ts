import { describe, expect, it } from "vitest";

describe("workspace bootstrap", () => {
  it("exposes the API health contract", async () => {
    const { createHealthPayload } = await import("./health.js");
    expect(createHealthPayload()).toEqual({ status: "ok", service: "api" });
  });
});
