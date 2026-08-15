export class FifoSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("semaphore capacity must be a positive integer");
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.capacity) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    };
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try { return await operation(); }
    finally { release(); }
  }
}

export class KeyedFifoSemaphore {
  private readonly semaphores = new Map<string, FifoSemaphore>();
  constructor(private readonly capacity: number) {}
  run<T>(key: string, operation: () => Promise<T>) {
    let semaphore = this.semaphores.get(key);
    if (!semaphore) {
      semaphore = new FifoSemaphore(this.capacity);
      this.semaphores.set(key, semaphore);
    }
    return semaphore.run(operation);
  }
}
