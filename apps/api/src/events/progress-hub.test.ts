import { describe, expect, it } from "vitest";

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
