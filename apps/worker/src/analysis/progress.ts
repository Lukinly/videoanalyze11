export function createProgressReporter(onProgress: (progress: number) => void, minimumIntervalMs = 100) {
  let lastAt = 0;
  let pending: number | null = null;

  return {
    report(progress: number) {
      const now = Date.now();
      if (now - lastAt >= minimumIntervalMs) {
        lastAt = now;
        onProgress(progress);
      } else {
        pending = progress;
      }
    },
    flush() {
      if (pending !== null) {
        lastAt = Date.now();
        onProgress(pending);
        pending = null;
      }
    }
  };
}
