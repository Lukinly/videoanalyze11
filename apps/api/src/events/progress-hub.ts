export type ProgressEvent = {
  stage: string;
  progress?: number;
  completedChunks?: number;
  totalChunks?: number;
  error?: string;
};

export function createProgressHub() {
  const subscribers = new Map<string, Set<(event: ProgressEvent) => void>>();

  return {
    publish(runId: string, event: ProgressEvent) {
      for (const subscriber of subscribers.get(runId) ?? []) subscriber(event);
    },
    subscribe(runId: string, subscriber: (event: ProgressEvent) => void) {
      const runSubscribers = subscribers.get(runId) ?? new Set();
      runSubscribers.add(subscriber);
      subscribers.set(runId, runSubscribers);
      return () => {
        runSubscribers.delete(subscriber);
        if (runSubscribers.size === 0) subscribers.delete(runId);
      };
    }
  };
}
