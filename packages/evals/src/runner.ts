import type { RunResult } from "@nanogent/core";
import type { EvalTask } from "./task.js";
import type { Change, HiddenResult } from "./verify.js";

export interface Attempt {
  taskId: string;
  attempt: number;
  difficulty: EvalTask["difficulty"];
  category: EvalTask["category"];
  runId: string;
  status: RunResult["status"];
  failureReason?: string;
  /** The task's verify command passed inside the agent's own sandbox. */
  visiblePass: boolean;
  /** Hidden tests passed in a fresh sandbox. This is the score. */
  passed: boolean;
  gradingError?: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunEvalOptions {
  tasks: readonly EvalTask[];
  repeat?: number;
  concurrency?: number;
  runTask(task: EvalTask, attempt: number): Promise<{ runId: string; result: RunResult }>;
  grade(task: EvalTask, change: Change): Promise<HiddenResult>;
  onAttempt?(attempt: Attempt): void;
}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(workers);
}

export async function runEval(options: RunEvalOptions): Promise<Attempt[]> {
  const jobs = options.tasks.flatMap((task) =>
    Array.from({ length: options.repeat ?? 1 }, (_, i) => ({ task, attempt: i + 1 })),
  );
  const attempts: Attempt[] = [];
  await pool(jobs, options.concurrency ?? 1, async ({ task, attempt }) => {
    const { runId, result } = await options.runTask(task, attempt);
    let grade: HiddenResult = { passed: false, exitCode: null, output: "" };
    if (result.status !== "canceled" && result.diff.trim() !== "")
      grade = await options.grade(task, { patch: result.diff });
    else grade.error = result.diff.trim() === "" ? "no changes" : "canceled";
    const record: Attempt = {
      taskId: task.id,
      attempt,
      difficulty: task.difficulty,
      category: task.category,
      runId,
      status: result.status,
      ...(result.failureReason && { failureReason: result.failureReason }),
      visiblePass: result.verified,
      passed: grade.passed,
      ...(grade.error && { gradingError: grade.error }),
      costUsd: result.usage.costUsd,
      durationMs: result.durationMs,
      turns: result.turns,
      toolCalls: result.toolCalls,
      inputTokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
      outputTokens: result.usage.output,
    };
    attempts.push(record);
    options.onAttempt?.(record);
  });
  return attempts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.attempt - b.attempt);
}

export interface TaskCheck {
  taskId: string;
  baselineFails: boolean;
  solutionPasses: boolean;
  detail?: string;
}

/** Sanity-checks the suite itself: the untouched repo must fail its hidden tests and the reference solution must pass. */
export async function checkTasks(
  tasks: readonly EvalTask[],
  grade: RunEvalOptions["grade"],
  concurrency = 2,
): Promise<TaskCheck[]> {
  const checks: TaskCheck[] = [];
  await pool(tasks, concurrency, async (task) => {
    const baseline = await grade(task, { none: true });
    const solution = task.solutionDir
      ? await grade(task, { solutionDir: task.solutionDir })
      : { passed: false, exitCode: null, output: "", error: "no solution/ directory" };
    const detail = solution.error ?? baseline.error;
    checks.push({
      taskId: task.id,
      baselineFails: !baseline.passed && baseline.error === undefined,
      solutionPasses: solution.passed,
      ...(detail && { detail }),
    });
  });
  return checks.sort((a, b) => a.taskId.localeCompare(b.taskId));
}
