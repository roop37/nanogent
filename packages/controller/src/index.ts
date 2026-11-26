import { setTimeout as delay } from "node:timers/promises";
import {
  type Brain,
  type Controller,
  type EventSink,
  type RunEvent,
  type RunEventInput,
  RunEventSchema,
  type RunResult,
  type RunSpec,
  RunSpecSchema,
  type RunStore,
  type SandboxProvider,
} from "@nanogent/core";
import { Executor } from "@nanogent/harness";

interface ActiveRun {
  abort: AbortController;
  done: Promise<RunResult>;
  approvals: Map<string, (decision: "allow" | "deny") => void>;
}
export class LocalController implements Controller {
  #runs = new Map<string, ActiveRun>();
  constructor(
    readonly store: RunStore,
    private readonly brain: Brain,
    private readonly provider: SandboxProvider,
  ) {}
  async submit(input: RunSpec): Promise<string> {
    const spec = RunSpecSchema.parse(input);
    await this.store.create(spec);
    const abort = new AbortController();
    const approvals = new Map<string, (decision: "allow" | "deny") => void>();
    let pending = Promise.resolve();
    const enqueue = (work: () => Promise<void>) => {
      const next = pending.then(work);
      pending = next;
      return next;
    };
    const events: EventSink = {
      emit: (event: RunEventInput) =>
        enqueue(async () => {
          let seq = 0;
          for await (const prior of this.store.events(spec.id)) seq = prior.seq;
          await this.store.append(
            RunEventSchema.parse({
              runId: spec.id,
              seq: seq + 1,
              ts: new Date().toISOString(),
              ...event,
            }),
          );
        }),
    };
    await events.emit({ type: "run.created", data: { spec } });
    const done = new Executor().execute(spec, {
      brain: this.brain,
      provider: this.provider,
      events,
      signal: abort.signal,
      transition: (state) => enqueue(() => this.store.setState(spec.id, state)),
      approve: async (request, signal) => {
        signal.throwIfAborted();
        let resolveDecision: (decision: "allow" | "deny") => void = () => {};
        const decision = new Promise<"allow" | "deny">((resolve) => {
          resolveDecision = resolve;
        });
        const cancel = () => resolveDecision("deny");
        approvals.set(request.approvalId, resolveDecision);
        signal.addEventListener("abort", cancel, { once: true });
        try {
          await enqueue(() => this.store.setState(spec.id, "awaiting_approval"));
          await events.emit({ type: "approval.requested", data: request });
          if (signal.aborted) cancel();
          const answer = await decision;
          await events.emit({
            type: "approval.resolved",
            data: { approvalId: request.approvalId, decision: answer },
          });
          await enqueue(() => this.store.setState(spec.id, "running"));
          signal.throwIfAborted();
          return answer;
        } finally {
          signal.removeEventListener("abort", cancel);
          approvals.delete(request.approvalId);
        }
      },
    });
    this.#runs.set(spec.id, { abort, done, approvals });
    void done.finally(() => this.#runs.delete(spec.id)).catch(() => {});
    return spec.id;
  }
  async cancel(runId: string): Promise<void> {
    const active = this.#runs.get(runId);
    if (active) {
      active.abort.abort();
      await active.done;
      return;
    }
    const record = await this.store.get(runId);
    if (!record) throw new Error("Run not found");
    if (!["completed", "failed", "canceled"].includes(record.state))
      throw new Error("Run is not active in this process");
  }
  async approve(runId: string, approvalId: string, decision: "allow" | "deny"): Promise<void> {
    if (decision !== "allow" && decision !== "deny") throw new Error("Invalid approval decision");
    const approvals = this.#runs.get(runId)?.approvals;
    const resolve = approvals?.get(approvalId);
    if (!resolve) throw new Error("Approval not pending");
    approvals?.delete(approvalId);
    resolve(decision);
  }
  async *watch(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent> {
    let seq = 1;
    while (!signal?.aborted) {
      if (!(await this.store.get(runId))) throw new Error("Run not found");
      for await (const event of this.store.events(runId, seq)) {
        if (signal?.aborted) return;
        seq = event.seq + 1;
        yield event;
        if (
          event.type === "run.state_changed" &&
          ["completed", "failed", "canceled"].includes(event.data.to)
        )
          return;
      }
      if (signal?.aborted) return;
      await delay(25, undefined, { ...(signal && { signal }) }).catch((error: unknown) => {
        if (!signal?.aborted) throw error;
      });
    }
  }
}

export { httpRunnerNotifier, RemoteController, type RunnerNotifier } from "./remote.js";
