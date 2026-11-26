export interface RunnerStore {
  listRunnable(limit: number): Promise<{ id: string; state: string }[]>;
}

export interface RunnerOptions {
  store: RunnerStore;
  /** Runs one stored run. Resolves to undefined when another worker holds it. */
  execute(runId: string, signal: AbortSignal): Promise<unknown>;
  /** Runs at the same time. */
  concurrency?: number;
  /** Look-up interval while runs are in progress. The database is awake then anyway. */
  busyPollMs?: number;
  /** Look-up interval while idle. Wake-ups normally arrive sooner; this only catches missed ones. */
  sweepMs?: number;
  /** How long to leave a run alone after another worker held it, or after an error. */
  backoffMs?: number;
  /** After stop(), how long running runs may take to finish before they are cancelled. */
  drainMs?: number;
  log?(message: string): void;
  now?(): number;
}

export interface Runner {
  /** Look for work now (a new run was saved). */
  wake(): void;
  /** Stop taking runs, let current ones finish for up to `drainMs`, then cancel the rest. */
  stop(): Promise<void>;
  readonly running: number;
}

export function startRunner(options: RunnerOptions): Runner {
  const concurrency = options.concurrency ?? 2;
  const busyPollMs = options.busyPollMs ?? 5_000;
  const sweepMs = options.sweepMs ?? 15 * 60_000;
  const backoffMs = options.backoffMs ?? 30_000;
  const drainMs = options.drainMs ?? 5 * 60_000;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;

  const inflight = new Map<string, Promise<void>>();
  const leaveAlone = new Map<string, number>();
  const stopping = new AbortController();
  const cancelRuns = new AbortController();
  let nudge: (() => void) | undefined;
  let wakePending = false;

  const wake = () => {
    wakePending = true;
    nudge?.();
  };

  async function lookForWork(): Promise<void> {
    if (inflight.size >= concurrency) return;
    const rows = await options.store.listRunnable(concurrency * 5 + inflight.size);
    for (const row of rows) {
      if (inflight.size >= concurrency || stopping.signal.aborted) return;
      if (inflight.has(row.id) || (leaveAlone.get(row.id) ?? 0) > now()) continue;
      start(row.id);
    }
  }

  function start(runId: string): void {
    log(`starting ${runId}`);
    const task = (async () => {
      try {
        const result = await options.execute(runId, cancelRuns.signal);
        if (result === undefined) leaveAlone.set(runId, now() + backoffMs);
        else log(`finished ${runId}`);
      } catch (error) {
        leaveAlone.set(runId, now() + backoffMs);
        log(`${runId} failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    })().finally(() => {
      inflight.delete(runId);
      wake();
    });
    inflight.set(runId, task);
  }

  const loop = (async () => {
    while (!stopping.signal.aborted) {
      try {
        await lookForWork();
      } catch (error) {
        log(`look-up failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (wakePending) {
        wakePending = false;
        continue;
      }
      const wait = inflight.size > 0 ? busyPollMs : sweepMs;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait);
        nudge = () => {
          clearTimeout(timer);
          resolve();
        };
        stopping.signal.addEventListener("abort", nudge, { once: true });
      });
      nudge = undefined;
      wakePending = false;
    }
  })();

  return {
    wake,
    get running() {
      return inflight.size;
    },
    async stop() {
      stopping.abort();
      await loop;
      const timer = setTimeout(() => cancelRuns.abort(new Error("Runner stopping")), drainMs);
      await Promise.allSettled([...inflight.values()]);
      clearTimeout(timer);
    },
  };
}
