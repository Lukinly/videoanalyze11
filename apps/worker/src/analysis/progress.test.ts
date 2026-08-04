import { describe, expect, it, vi } from "vitest";

describe("progress reporter", () => {
  it("limits updates to the configured interval and flushes the latest value", async () => {
    vi.useFakeTimers();
    try {
      const { createProgressReporter } = await import("./progress.js");
      const onProgress = vi.fn();
      const reporter = createProgressReporter(onProgress, 100);

      reporter.report(0.1);
      reporter.report(0.2);
      expect(onProgress).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      reporter.flush();
      expect(onProgress).toHaveBeenLastCalledWith(0.2);
    } finally {
      vi.useRealTimers();
    }
  });
});
