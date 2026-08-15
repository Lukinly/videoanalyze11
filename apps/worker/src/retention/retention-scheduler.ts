import type { RetentionSweepReport } from "./cleanup-worker.js";

type Clock = { now(): Date };
type TimerHandle = ReturnType<typeof setInterval> | unknown;
type Timers = {
  setInterval(callback: () => void, milliseconds: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export type RetentionScheduler = {
  started: Promise<void>;
  close(): Promise<void>;
};

export function startRetentionScheduler(input: {
  sweep(input: { now: Date }): Promise<RetentionSweepReport | void>;
  clock: Clock;
  timers?: Timers;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): RetentionScheduler {
  const timers = input.timers ?? { setInterval, clearInterval };
  const intervalMs = input.intervalMs ?? 900_000;
  const onError = input.onError ?? ((error: unknown) => console.error("retention sweep failed", error));
  let closed = false;
  let active: Promise<void> | null = null;

  const run = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (active) return active;
    try {
      active = input.sweep({ now: input.clock.now() })
      .then(() => undefined)
      .catch(onError)
      .finally(() => { active = null; });
    } catch (error) {
      onError(error);
      active = Promise.resolve().finally(() => { active = null; });
    }
    return active;
  };

  const started = run();
  const timer = timers.setInterval(() => { void run(); }, intervalMs);

  return {
    started,
    async close() {
      if (!closed) {
        closed = true;
        timers.clearInterval(timer);
      }
      await active;
    }
  };
}
