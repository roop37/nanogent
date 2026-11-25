import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRunId, DEFAULT_LIMITS, type Limits, type SandboxProvider } from "@nanogent/core";
import type { EvalTask } from "./task.js";

const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

async function git(cwd: string, args: string[]): Promise<void> {
  await run("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, env: GIT_ENV });
}

export type Change = { patch: string } | { solutionDir: string } | { none: true };

export interface HiddenResult {
  passed: boolean;
  exitCode: number | null;
  output: string;
  /** Set when grading could not run at all, e.g. the patch didn't apply. */
  error?: string;
}

/**
 * Builds the tree that gets graded: the task repo, the agent's change on top, then the hidden tests.
 * The patch is applied on the host with `git apply`, which refuses paths outside the tree.
 */
export async function prepareTree(task: EvalTask, change: Change, dir: string): Promise<void> {
  await cp(task.repoDir, dir, { recursive: true });
  await git(dir, ["init", "-q"]);
  await git(dir, ["add", "-A"]);
  await git(dir, [
    "-c",
    "user.name=eval",
    "-c",
    "user.email=eval@localhost",
    "commit",
    "-qm",
    "base",
  ]);
  if ("patch" in change && change.patch.trim() !== "") {
    const patchFile = `${dir}.patch`;
    await writeFile(patchFile, change.patch.endsWith("\n") ? change.patch : `${change.patch}\n`);
    try {
      await git(dir, ["apply", "--whitespace=nowarn", patchFile]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      throw new Error(`patch did not apply: ${stderr.trim().slice(0, 500)}`);
    } finally {
      await rm(patchFile, { force: true });
    }
  }
  if ("solutionDir" in change) await cp(change.solutionDir, dir, { recursive: true });
  await cp(task.hiddenDir, dir, { recursive: true });
}

/** Grades a change in a fresh sandbox the agent never touched. */
export async function verifyHidden(
  task: EvalTask,
  change: Change,
  provider: SandboxProvider,
  limits: Limits = DEFAULT_LIMITS,
): Promise<HiddenResult> {
  const root = await mkdtemp(join(tmpdir(), `nanogent-eval-${task.id}-`));
  const dir = join(root, "repo");
  try {
    try {
      await prepareTree(task, change, dir);
    } catch (error) {
      return { passed: false, exitCode: null, output: "", error: (error as Error).message };
    }
    const sandbox = await provider.create({
      id: createRunId(),
      repo: { localPath: dir },
      setupCommands: task.setup,
      limits,
    });
    try {
      const result = await sandbox.exec(task.verify, {
        timeoutSec: limits.commandTimeoutSec,
        maxOutputBytes: limits.maxToolOutputBytes,
      });
      const exitCode = result.timedOut ? null : result.exitCode;
      return { passed: exitCode === 0, exitCode, output: result.stdout + result.stderr };
    } finally {
      await sandbox.destroy();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
