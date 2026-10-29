export type ProgressEvent = {
  stage: string;
  status?: string;
  progress?: number;
  completedChunks?: number;
  totalChunks?: number;
  error?: string;
};

// Read persisted progress so API and Worker can run in separate processes.
// One poll per subscribed run is shared by all its SSE clients.
export function createProgressHub(options: {
  load?: (runId: string) => Promise<ProgressEvent | null>;
  intervalMs?: number;
} = {}) {
  const subscribers = new Map<string, Set<(event: ProgressEvent) => void>>();
  const polls = new Map<string, ReturnType<typeof setInterval>>();
  const snapshots = new Map<string, string>();
  const inFlight = new Set<string>();

  const publish = (runId: string, event: ProgressEvent) => {
    for (const subscriber of subscribers.get(runId) ?? []) subscriber(event);
  };
  const poll = async (runId: string) => {
    if (!options.load || inFlight.has(runId)) return;
    inFlight.add(runId);
    try {
      const event = await options.load(runId);
      if (!subscribers.has(runId) || !event) return;
      const snapshot = JSON.stringify(event);
      if (snapshots.get(runId) !== snapshot) {
        snapshots.set(runId, snapshot);
        publish(runId, event);
      }
    } catch {
      // Keep the stream alive during temporary database failures; retry next tick.
    } finally {
      inFlight.delete(runId);
    }
  };
  return {
    publish,
    subscribe(runId: string, subscriber: (event: ProgressEvent) => void) {
      const runSubscribers = subscribers.get(runId) ?? new Set();
      runSubscribers.add(subscriber);
      subscribers.set(runId, runSubscribers);
      const snapshot = snapshots.get(runId);
      if (snapshot) subscriber(JSON.parse(snapshot) as ProgressEvent);
      if (options.load && !polls.has(runId)) {
        const timer = setInterval(() => { void poll(runId); }, options.intervalMs ?? 1000);
        timer.unref();
        polls.set(runId, timer);
        void poll(runId);
      }
      return () => {
        runSubscribers.delete(subscriber);
        if (runSubscribers.size === 0) {
          subscribers.delete(runId);
          clearInterval(polls.get(runId));
          polls.delete(runId);
          snapshots.delete(runId);
        }
      };
    },
    close() {
      for (const timer of polls.values()) clearInterval(timer);
      polls.clear();
      snapshots.clear();
      subscribers.clear();
    }
  };
}
