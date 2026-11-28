import { setTimeout as delay } from "node:timers/promises";
import {
  type Brain,
  type EventSink,
  RunIdSchema,
  type RunResult,
  type SandboxProvider,
} from "@nanogent/core";
import { Executor } from "@nanogent/harness";
import type { PostgresRunStore } from "@nanogent/store";

export interface Progress {
  state: string;
  turns: number;
  costUsd: number;
}
export interface ExecuteDeps {
  store: PostgresRunStore;
  brain: Brain;
  provider: SandboxProvider | ((events: EventSink) => SandboxProvider);
  signal?: AbortSignal;
  progress?(progress: Progress): Promise<void>;
  retryableSetup?(error: unknown): boolean;
  setupRetryDelayMs?: number;
}
const terminal = (state: string) => ["completed", "failed", "canceled"].includes(state);

export async function executeStoredRun(
  runId: string,
  deps: ExecuteDeps,
): Promise<RunResult | undefined> {
  RunIdSchema.parse(runId);
  return deps.store.withExecutionLock(runId, () => executeLockedRun(runId, deps));
}

async function executeLockedRun(runId: string, deps: ExecuteDeps): Promise<RunResult | undefined> {
  const { store } = deps;
  const record = await store.get(runId);
  if (!record) throw new Error("Run not found");
  if (terminal(record.state)) return record.result;
  if (record.state !== "queued") {
    const result: RunResult = {
      status: "failed",
      summary: "",
      diff: "",
      verified: false,
      verify: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      turns: 0,
      toolCalls: 0,
      durationMs: 0,
      failureReason: "Previous worker stopped while this run was active; create a new run to retry",
    };
    let startedAt: number | undefined;
    for await (const event of store.events(runId)) {
      startedAt ??= Date.parse(event.ts);
      if (event.type === "model.response") {
        result.turns++;
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "costUsd"] as const)
          result.usage[key] += event.data.usage[key];
      }
      if (event.type === "tool.call") result.toolCalls++;
    }
    result.durationMs = startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
    await store.finish(runId, result);
    try {
      await deps.progress?.({
        state: "failed",
        turns: result.turns,
        costUsd: result.usage.costUsd,
      });
    } catch {}
    return result;
  }
  if (record.cancelRequested || deps.signal?.aborted) {
    await store.setState(runId, "canceled");
    return;
  }
  try {
    await store.setState(runId, "running");
  } catch (error) {
    const current = await store.get(runId);
    if (current && current.state !== "queued") return current.result;
    throw error;
  }
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, ...(deps.signal ? [deps.signal] : [])]);
  const stopPolling = new AbortController();
  const progress: Progress = { state: "running", turns: 0, costUsd: 0 };
  const publish = async () => {
    // Realtime metadata is a projection; a failed update must not replay a model call.
    try {
      await deps.progress?.({ ...progress });
    } catch {
      /* Postgres remains authoritative. */
    }
  };
  const events: EventSink = {
    emit: async (event) => {
      if (event.type === "run.result") await store.finish(runId, event.data);
      else await store.emit(runId, event);
      if (event.type === "model.response") {
        progress.turns++;
        progress.costUsd += event.data.usage.costUsd;
      }
      if (event.type === "run.result") {
        progress.state = event.data.status;
        progress.turns = event.data.turns;
        progress.costUsd = event.data.usage.costUsd;
      }
      await publish();
    },
  };
  const provider = typeof deps.provider === "function" ? deps.provider(events) : deps.provider;
  const polling = (async () => {
    while (!stopPolling.signal.aborted) {
      const current = await store.get(runId);
      if (current?.cancelRequested) {
        abort.abort(new Error("Cancellation requested"));
        return;
      }
      await delay(250, undefined, { signal: stopPolling.signal });
    }
  })().catch(() => {
    if (!stopPolling.signal.aborted) abort.abort(new Error("Cancellation monitor failed"));
  });
  try {
    await publish();
    return await new Executor().execute(record.spec, {
      loadDraft: async () => {
        if (record.draftVersion === null) return undefined;
        const snapshot = await store.draft(runId);
        if (!snapshot || snapshot.version !== record.draftVersion)
          throw new Error("Run draft snapshot is unavailable");
        return snapshot;
      },
      brain: deps.brain,
      events,
      signal,
      transition: async (state) => {
        if (state === "running" || terminal(state)) return;
        await store.setState(runId, state);
        progress.state = state;
        await publish();
      },
      provider: {
        create: async (spec, signal) => {
          if (!("url" in spec.repo))
            throw new Error("Hosted runs require public HTTPS repositories");
          for (let attempt = 0; ; attempt++) {
            signal?.throwIfAborted();
            try {
              return await provider.create(spec, signal);
            } catch (error) {
              if (attempt >= 2 || signal?.aborted || !deps.retryableSetup?.(error)) throw error;
              await events.emit({
                type: "log",
                data: {
                  level: "warn",
                  message: "Transient sandbox setup failure; retrying before the model starts",
                },
              });
              await delay((deps.setupRetryDelayMs ?? 1000) * 2 ** attempt, undefined, {
                ...(signal && { signal }),
              });
            }
          }
        },
      },
    });
  } finally {
    stopPolling.abort();
    await polling;
  }
}
