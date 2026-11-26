import { type RunSpec, RunSpecSchema } from "@nanogent/core";
import type { PostgresRunStore } from "@nanogent/store";
import type { executeRun } from "@nanogent/worker";
import { runs, tasks } from "@trigger.dev/sdk";

export interface RemoteTasks {
  trigger(
    taskId: "execute-run",
    payload: { runId: string },
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
  cancel(triggerRunId: string): Promise<unknown>;
}
const triggerTasks: RemoteTasks = {
  trigger: (taskId, payload, options) => tasks.trigger<typeof executeRun>(taskId, payload, options),
  cancel: (id) => runs.cancel(id),
};

export class RemoteController {
  constructor(
    readonly store: Pick<
      PostgresRunStore,
      "create" | "get" | "emit" | "bindTrigger" | "requestCancel"
    >,
    private readonly sdk: RemoteTasks = triggerTasks,
  ) {}
  async submit(input: RunSpec, options: { ownerId?: string } = {}): Promise<string> {
    const spec = RunSpecSchema.parse(input);
    await this.store.create(spec, options);
    await this.store.emit(spec.id, { type: "run.created", data: { spec } });
    await this.enqueue(spec.id);
    return spec.id;
  }
  async enqueue(runId: string): Promise<void> {
    const record = await this.store.get(runId);
    if (!record) throw new Error("Run not found");
    if (["completed", "failed", "canceled"].includes(record.state)) return;
    const handle = await this.sdk.trigger("execute-run", { runId }, { idempotencyKey: runId });
    await this.store.bindTrigger(runId, handle.id);
    if ((await this.store.get(runId))?.cancelRequested) await this.sdk.cancel(handle.id);
  }
  async cancel(runId: string): Promise<void> {
    const record = await this.store.requestCancel(runId);
    if (record.triggerRunId && record.cancelRequested) await this.sdk.cancel(record.triggerRunId);
  }
}
