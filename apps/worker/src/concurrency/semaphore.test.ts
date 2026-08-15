import { describe, expect, it } from "vitest";
import { FifoSemaphore } from "./semaphore.js";

describe("FIFO semaphore", () => {
  it("runs waiters in arrival order and releases capacity after errors", async () => {
    const semaphore = new FifoSemaphore(1);
    const events: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const first = semaphore.run(async () => { events.push("first"); await gate; throw new Error("boom"); });
    const second = semaphore.run(async () => { events.push("second"); return 2; });
    const third = semaphore.run(async () => { events.push("third"); return 3; });

    await Promise.resolve();
    expect(events).toEqual(["first"]);
    unblock();
    await expect(first).rejects.toThrow("boom");
    await expect(Promise.all([second, third])).resolves.toEqual([2, 3]);
    expect(events).toEqual(["first", "second", "third"]);
  });
});
