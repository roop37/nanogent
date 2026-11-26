import { type RunSpec, RunSpecSchema, signWake, WAKE_HEADER } from "@nanogent/core";
import type { PostgresRunStore } from "@nanogent/store";

/** Tells a runner that a new run is waiting. Delivery is best effort: runners also sweep the database. */
export interface RunnerNotifier {
  wake(runId: string): Promise<void>;
}

export function httpRunnerNotifier(options: {
  url: string;
  secret: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): RunnerNotifier {
  const send = options.fetch ?? fetch;
  return {
    async wake(runId) {
      const body = JSON.stringify({ runId });
      await send(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [WAKE_HEADER]: signWake(options.secret, body),
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
      });
    },
  };
}

/**
 * Controller for the hosted service. A saved `queued` run is the queue entry: runners read it from
 * Postgres, so submitting only has to write the row (and optionally nudge a runner). Cancelling sets a
 * flag that the runner watches, or ends a queued run directly.
 */
export class RemoteController {
  constructor(
    private readonly store: Pick<PostgresRunStore, "create" | "emit" | "requestCancel">,
    private readonly notifier?: RunnerNotifier,
  ) {}

  async submit(input: RunSpec, options: { ownerId?: string } = {}): Promise<string> {
    const spec = RunSpecSchema.parse(input);
    await this.store.create(spec, options);
    await this.store.emit(spec.id, { type: "run.created", data: { spec } });
    // The run is already saved; a missed nudge only delays it until the next sweep.
    await this.notifier?.wake(spec.id).catch(() => {});
    return spec.id;
  }

  async cancel(runId: string): Promise<void> {
    await this.store.requestCancel(runId);
  }
}
