import { describe, expect, it, vi } from "vitest";
import { startRetentionScheduler } from "./retention-scheduler.js";

describe("retention scheduler", () => {
  it("runs immediately, uses a 900-second interval, and never overlaps sweeps", async () => {
    const first = deferred<void>();
    const sweep = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const timer = fakeTimers();
    const clock = { now: vi.fn().mockReturnValue(new Date("2026-08-15T12:00:00.000Z")) };
    const scheduler = startRetentionScheduler({ sweep, clock, timers: timer.api });
    expect(sweep).toHaveBeenCalledOnce();
    expect(sweep).toHaveBeenCalledWith({ now: new Date("2026-08-15T12:00:00.000Z") });
    expect(timer.intervalMs).toBe(900_000);
    timer.tick();
    expect(sweep).toHaveBeenCalledOnce();
    first.resolve();
    await scheduler.started;
    timer.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
    await scheduler.close();
  });

  it("clears the timer, prevents future starts, and waits for an active sweep before closing", async () => {
    const active = deferred<void>();
    const sweep = vi.fn().mockReturnValue(active.promise);
    const timer = fakeTimers();
    const scheduler = startRetentionScheduler({ sweep, clock: { now: () => new Date("2026-08-15T12:00:00.000Z") }, timers: timer.api });
    let closed = false;
    const closing = scheduler.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(timer.clearInterval).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    timer.tick();
    expect(sweep).toHaveBeenCalledOnce();
    active.resolve();
    await closing;
    expect(closed).toBe(true);
  });

  it("continues scheduling after a synchronous sweep failure", async () => {
    const timer = fakeTimers();
    const onError = vi.fn();
    const sweep = vi.fn()
      .mockImplementationOnce(() => { throw new Error("startup failure"); })
      .mockResolvedValue(undefined);
    const scheduler = startRetentionScheduler({
      sweep,
      onError,
      clock: { now: () => new Date("2026-08-15T12:00:00.000Z") },
      timers: timer.api
    });

    await scheduler.started;
    timer.tick();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "startup failure" }));
    expect(sweep).toHaveBeenCalledTimes(2);
    await scheduler.close();
  });
});

function fakeTimers() {
  let callback: (() => void) | undefined;
  let intervalMs: number | undefined;
  const clearInterval = vi.fn();
  return {
    api: { setInterval(next: () => void, ms: number) { callback = next; intervalMs = ms; return "retention-timer"; }, clearInterval },
    get intervalMs() { return intervalMs; }, clearInterval, tick() { callback?.(); }
  };
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
