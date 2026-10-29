import { describe, expect, it, vi } from "vitest";

describe("analysis progress hub", () => {
  it("does not deliver another run's events", async () => {
    const { createProgressHub } = await import("./progress-hub.js");
    const hub = createProgressHub();
    const events: unknown[] = [];
    const unsubscribe = hub.subscribe("run_1", (event) => events.push(event));

    hub.publish("run_2", { stage: "transcribing" });
    hub.publish("run_1", { stage: "completed" });
    unsubscribe();
    hub.publish("run_1", { stage: "late" });

    expect(events).toEqual([{ stage: "completed" }]);
  });
});

it("streams persisted worker progress and releases polling after disconnect", async () => {
  vi.useFakeTimers();
  const { createProgressHub } = await import("./progress-hub.js");
  const load = vi.fn().mockResolvedValue({ stage: "transcribing", status: "running", progress: 0.2 });
  const hub = createProgressHub({ load });
  const first = vi.fn();
  const second = vi.fn();
  try {
    const unsubscribe = hub.subscribe("run", first);
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribeSecond = hub.subscribe("run", second);
    expect(second).toHaveBeenCalledWith({ stage: "transcribing", status: "running", progress: 0.2 });
    load.mockResolvedValue({ stage: "completed", status: "completed", progress: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(first).toHaveBeenLastCalledWith({ stage: "completed", status: "completed", progress: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
    unsubscribeSecond();
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(2);
  } finally { hub.close(); vi.useRealTimers(); }
});
