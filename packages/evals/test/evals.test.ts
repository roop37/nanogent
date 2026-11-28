import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RunResult } from "@nanogent/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Attempt,
  checkTasks,
  compareReference,
  type EvalTask,
  evalProtocol,
  loadTasks,
  prepareTree,
  runEval,
  summarize,
  toMarkdown,
} from "../src/index.js";

const run = promisify(execFile);
const TASKS = fileURLToPath(new URL("../../../evals/tasks", import.meta.url));
const temps: string[] = [];
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nanogent-evals-test-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: "completed",
    summary: "done",
    diff: "diff --git a/x b/x\n",
    verify: { command: "node --test", exitCode: 0, output: "" },
    verified: true,
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
    turns: 3,
    toolCalls: 4,
    durationMs: 2000,
    ...overrides,
  } as RunResult;
}

async function solutionPatch(task: EvalTask): Promise<string> {
  const dir = join(await temp(), "repo");
  await prepareTree(task, { none: true }, dir);
  // prepareTree adds hidden tests; reset to the committed base before applying the solution.
  await run("git", ["checkout", "-q", "--", "."], { cwd: dir });
  await run("git", ["clean", "-qfd"], { cwd: dir });
  await cp(task.solutionDir as string, dir, { recursive: true });
  await run("git", ["add", "-N", "."], { cwd: dir });
  return (await run("git", ["diff"], { cwd: dir })).stdout;
}

describe("tasks", () => {
  it("loads the bundled suite", async () => {
    const tasks = await loadTasks(TASKS);
    expect(tasks).toHaveLength(14);
    expect(new Set(tasks.map((t) => t.category))).toEqual(
      new Set(["bug", "multi-file", "debugging", "refactor", "environment"]),
    );
    for (const task of tasks) expect(task.solutionDir).toBeDefined();
  });
  it("filters and rejects unknown ids", async () => {
    expect((await loadTasks(TASKS, ["slugify-spaces"])).map((t) => t.id)).toEqual([
      "slugify-spaces",
    ]);
    await expect(loadTasks(TASKS, ["nope"])).rejects.toThrow(/Unknown task: nope/);
  });
});

describe("prepareTree", () => {
  it("applies an agent patch and then adds hidden tests", async () => {
    const [task] = await loadTasks(TASKS, ["invoice-currency"]);
    const patch = await solutionPatch(task as EvalTask);
    const dir = join(await temp(), "graded");
    await prepareTree(task as EvalTask, { patch }, dir);
    expect(await readFile(join(dir, "money.js"), "utf8")).toContain("INR");
    expect(await readFile(join(dir, "invoice.hidden.test.js"), "utf8")).toContain("formatPrice");
  });
  it("reports a patch that doesn't apply", async () => {
    const [task] = await loadTasks(TASKS, ["slugify-spaces"]);
    const patch =
      "diff --git a/nope.js b/nope.js\n--- a/nope.js\n+++ b/nope.js\n@@ -1 +1 @@\n-a\n+b\n";
    await expect(prepareTree(task as EvalTask, { patch }, join(await temp(), "x"))).rejects.toThrow(
      /patch did not apply/,
    );
  });
  it("refuses paths outside the tree", async () => {
    const [task] = await loadTasks(TASKS, ["slugify-spaces"]);
    const patch =
      "diff --git a/../escape.js b/../escape.js\nnew file mode 100644\n--- /dev/null\n+++ b/../escape.js\n@@ -0,0 +1 @@\n+x\n";
    await expect(prepareTree(task as EvalTask, { patch }, join(await temp(), "x"))).rejects.toThrow(
      /patch did not apply/,
    );
  });
});

describe("runEval", () => {
  const tasks = [
    { id: "a", difficulty: "easy", category: "bug" },
    { id: "b", difficulty: "medium", category: "refactor" },
  ] as EvalTask[];

  it("repeats tasks, grades only real changes and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const graded: string[] = [];
    const attempts = await runEval({
      tasks,
      repeat: 2,
      concurrency: 3,
      runTask: async (task, attempt) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return {
          runId: `${task.id}-${attempt}`,
          result:
            task.id === "b" && attempt === 2 ? result({ diff: "", status: "failed" }) : result(),
        };
      },
      grade: async (task) => {
        graded.push(task.id);
        return { passed: task.id === "a", exitCode: task.id === "a" ? 0 : 1, output: "" };
      },
    });
    expect(attempts.map((a) => `${a.taskId}${a.attempt}`)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(peak).toBe(3);
    expect(graded.sort()).toEqual(["a", "a", "b"]);
    expect(attempts.find((a) => a.taskId === "b" && a.attempt === 2)?.gradingError).toBe(
      "no changes",
    );
    expect(attempts.filter((a) => a.passed)).toHaveLength(2);
  });

  it("checkTasks flags a broken task", async () => {
    const checks = await checkTasks(
      [
        { id: "good", solutionDir: "/s" },
        { id: "bad", solutionDir: "/s" },
      ] as EvalTask[],
      async (task, change) => ({
        passed: "solutionDir" in change || task.id === "bad",
        exitCode: 0,
        output: "",
      }),
    );
    expect(checks).toEqual([
      { taskId: "bad", baselineFails: false, solutionPasses: true },
      { taskId: "good", baselineFails: true, solutionPasses: true },
    ]);
  });
});

it("grades a paired reference trajectory and rejects incompatible input", async () => {
  const tasks = await loadTasks(TASKS, ["slugify-spaces"]);
  const [task] = tasks;
  if (!task) throw new Error("Missing fixture");
  const protocol = await evalProtocol(tasks, {
    model: "claude-haiku-5-5",
    maxCostUsd: 0.15,
    repeat: 1,
  });
  const referenceDir = await temp();
  const reportPath = join(referenceDir, "report.json");
  const trajectoryPath = join(referenceDir, `${task.id}.1.traj.json`);
  const patch = await solutionPatch(task);
  await writeFile(
    reportPath,
    JSON.stringify({
      protocol,
      attempts: [{ taskId: task.id, attempt: 1, passed: false, costUsd: 0.07 }],
    }),
  );
  const mini = {
    trajectory_format: "mini-swe-agent-1.1",
    info: {
      mini_version: "2.0.0",
      exit_status: "Submitted",
      submission: patch,
      model_stats: { instance_cost: 0.04 },
      config: { model: { model_name: "anthropic/claude-haiku-5-5" }, agent: { cost_limit: 0.15 } },
    },
  };
  await writeFile(trajectoryPath, JSON.stringify(mini));
  const grade: Parameters<typeof compareReference>[0]["grade"] = async (submittedTask, change) => {
    expect(submittedTask.id).toBe(task.id);
    const dir = join(await temp(), "paired");
    await prepareTree(submittedTask, change, dir);
    await run("node", ["--test"], { cwd: dir });
    return { passed: true, exitCode: 0, output: "" };
  };
  const options = { tasks, protocol, reportPath, referenceDir, grade };
  expect(await compareReference(options)).toMatchObject({
    nanogent: { attempts: 1, passed: 0, costUsd: 0.07, costPerPass: null },
    miniSweAgent: { attempts: 1, passed: 1, successRate: 1, costUsd: 0.04, costPerPass: 0.04 },
  });
  await expect(
    compareReference({ ...options, protocol: { ...protocol, suiteDigest: "0".repeat(64) } }),
  ).rejects.toThrow("Nanogent report does not match");
  mini.info.config.agent.cost_limit = 0.5;
  await writeFile(trajectoryPath, JSON.stringify(mini));
  await expect(compareReference(options)).rejects.toThrow("model or budget mismatch");
});

describe("summarize", () => {
  const base = {
    difficulty: "easy",
    category: "bug",
    runId: "r",
    status: "completed",
    turns: 1,
    toolCalls: 1,
  };
  const attempts = [
    {
      ...base,
      taskId: "a",
      attempt: 1,
      passed: true,
      visiblePass: true,
      costUsd: 0.02,
      durationMs: 1000,
    },
    {
      ...base,
      taskId: "b",
      attempt: 1,
      passed: false,
      visiblePass: true,
      costUsd: 0.06,
      durationMs: 3000,
    },
    {
      ...base,
      taskId: "c",
      attempt: 1,
      difficulty: "medium",
      passed: true,
      visiblePass: false,
      costUsd: 0.04,
      durationMs: 2000,
    },
  ] as Attempt[];

  it("computes rates, cost per pass and medians", () => {
    const s = summarize(attempts, { model: "m", effort: "low", startedAt: "t" });
    expect(s.passed).toBe(2);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.totalCostUsd).toBeCloseTo(0.12);
    expect(s.passedPerDollar).toBeCloseTo(2 / 0.12);
    expect(s.medianCostPerPass).toBeCloseTo(0.03);
    expect(s.medianDurationMs).toBe(2000);
    expect(s.byDifficulty).toEqual({
      easy: { attempts: 2, passed: 1, rate: 0.5 },
      medium: { attempts: 1, passed: 1, rate: 1 },
    });
    expect(s.visibleButNotHidden).toBe(1);
    expect(toMarkdown(s, attempts)).toContain("| a | 1 | pass | $0.0200 |");
  });

  it("handles a run with no cost", () => {
    expect(summarize([], { model: "m", effort: "low", startedAt: "t" }).passedPerDollar).toBeNull();
  });
});
