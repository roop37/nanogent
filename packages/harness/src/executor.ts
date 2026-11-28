import {
  type Brain,
  Budget,
  type EventSink,
  type RunResult,
  RunResultSchema,
  type RunSpec,
  RunSpecSchema,
  type RunState,
  type Sandbox,
  type SandboxProvider,
} from "@nanogent/core";
import { type Approver, PermissionPolicy, ToolRegistry } from "./registry.js";
import { builtInTools } from "./tools.js";

export interface ExecutorDeps {
  brain: Brain;
  provider: SandboxProvider;
  events: EventSink;
  transition(state: RunState): Promise<void>;
  signal?: AbortSignal;
  approve?: Approver;
}
export class Executor {
  async execute(input: RunSpec, deps: ExecutorDeps): Promise<RunResult> {
    const spec = RunSpecSchema.parse(input);
    const budget = new Budget(spec.limits);
    const timeout = new AbortController();
    const signal = AbortSignal.any([timeout.signal, ...(deps.signal ? [deps.signal] : [])]);
    const timer = setTimeout(
      () => timeout.abort(new Error("Wall-clock budget exceeded")),
      spec.limits.maxWallClockSec * 1000,
    );
    let sandbox: Sandbox | undefined;
    let summary = "";
    let diff = "";
    let verify: RunResult["verify"] = null;
    let status: RunResult["status"] = "failed";
    let failureReason: string | undefined;
    try {
      if (signal.aborted) {
        status = "canceled";
        signal.throwIfAborted();
      }
      await deps.transition("running");
      sandbox = await deps.provider.create(
        { id: spec.id, repo: spec.repo, setupCommands: spec.setupCommands, limits: spec.limits },
        signal,
      );
      signal.throwIfAborted();
      await deps.events.emit({ type: "sandbox.ready", data: { sandboxId: sandbox.id } });
      const ctx = {
        runId: spec.id,
        sandbox,
        limits: spec.limits,
        budget,
        events: deps.events,
        signal,
      };
      const registry = new ToolRegistry(
        builtInTools(sandbox.workspace),
        new PermissionPolicy(spec.policy),
        deps.approve,
      );
      const outcome = await deps.brain.run({
        ...ctx,
        spec,
        history: spec.conversation?.length
          ? [
              ...spec.conversation.flatMap(({ task, answer }) => [
                { role: "user" as const, content: task },
                { role: "assistant" as const, content: answer },
              ]),
              { role: "user", content: spec.task },
            ]
          : [],
        tools: registry.tools(ctx),
      });
      signal.throwIfAborted();
      summary = outcome.summary;
      if (outcome.status !== "submitted") {
        status = outcome.status;
        failureReason = outcome.failureReason ?? "Brain did not submit";
      } else {
        const check = budget.check();
        if (!check.ok) throw new Error(`Budget exceeded: ${check.reason}`);
        if (spec.verifyCommand) {
          const verifyStarted = performance.now();
          const execution = await sandbox.exec(spec.verifyCommand, {
            timeoutSec: spec.limits.commandTimeoutSec,
            maxOutputBytes: spec.limits.maxToolOutputBytes,
            signal,
          });
          signal.throwIfAborted();
          verify = {
            durationMs: Math.max(0, performance.now() - verifyStarted),
            command: spec.verifyCommand,
            exitCode: execution.timedOut ? null : execution.exitCode,
            output: execution.stdout + execution.stderr,
          };
          await deps.events.emit({ type: "verify.result", data: verify });
          status = verify.exitCode === 0 ? "completed" : "failed";
          if (status === "failed") failureReason = "Verification failed";
        } else {
          status = "completed";
        }
      }
      diff = await sandbox.diff({ maxBytes: spec.limits.maxToolOutputBytes * 10, signal });
      signal.throwIfAborted();
    } catch (error) {
      status = deps.signal?.aborted ? "canceled" : "failed";
      failureReason = timeout.signal.aborted
        ? "budget: maxWallClockSec"
        : error instanceof Error
          ? error.message
          : "Execution failed";
      if (timeout.signal.aborted)
        await deps.events.emit({
          type: "budget.exceeded",
          data: {
            reason: "maxWallClockSec",
            limit: spec.limits.maxWallClockSec,
            actual: budget.snapshot().elapsedMs / 1000,
          },
        });
    } finally {
      clearTimeout(timer);
      try {
        await sandbox?.destroy();
      } catch {
        status = "failed";
        failureReason = "Sandbox cleanup failed; run gc";
      }
    }
    const snapshot = budget.snapshot();
    const result = RunResultSchema.parse({
      status,
      summary,
      diff,
      verify,
      verified: status === "completed" && verify?.exitCode === 0,
      usage: snapshot.usage,
      turns: snapshot.turns,
      toolCalls: snapshot.toolCalls,
      durationMs: snapshot.elapsedMs,
      ...(failureReason && { failureReason }),
    });
    await deps.events.emit({ type: "run.result", data: result });
    await deps.transition(status);
    return result;
  }
}
