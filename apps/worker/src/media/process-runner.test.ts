import { describe, expect, it } from "vitest";
import { createProcessRunner } from "./process-runner.js";

describe("process runner limits", () => {
  it("terminates a command after its wall-clock limit", async () => {
    await expect(createProcessRunner().run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 30 }))
      .rejects.toThrow("timed out");
  });

  it("terminates a command whose captured output exceeds the limit", async () => {
    await expect(createProcessRunner().run(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], { maxOutputBytes: 100 }))
      .rejects.toThrow("output limit");
  });
});
