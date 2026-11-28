import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRunId, DEFAULT_LIMITS, type Limits, type SandboxProvider } from "@nanogent/core";
import type { EvalTask } from "./task.js";

const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: GIT_ENV,
    timeout: 10_000,
  });
  return stdout;
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
  const runId = createRunId();
  let patch: string | undefined;
  try {
    try {
      await prepareTree(task, change, dir);
      if (task.setup.length > 0) {
        // Only the original fixture is present during network-enabled setup.
        await git(dir, ["add", "-A", "--force"]);
        patch = await git(dir, ["diff", "--cached", "--binary", "HEAD"]);
      }
    } catch (error) {
      return { passed: false, exitCode: null, output: "", error: (error as Error).message };
    }
    const sandbox = await provider.create({
      id: runId,
      repo: { localPath: patch === undefined ? dir : task.repoDir },
      setupCommands: task.setup,
      limits,
    });
    try {
      const commandOptions = {
        timeoutSec: limits.commandTimeoutSec,
        maxOutputBytes: limits.maxToolOutputBytes,
      };
      if (patch) {
        const workspace = sandbox.workspace ?? "/workspace";
        const file = `${workspace}/.nanogent-grade-${runId}.patch`;
        const encoded = Buffer.from(patch).toString("base64");
        const parts: string[] = [];
        // The sandbox file helper passes its input as a single command argument.
        for (let offset = 0; offset < encoded.length; offset += 48_000) {
          const part = `${file}.${parts.length}`;
          await sandbox.writeFile(part, encoded.slice(offset, offset + 48_000));
          parts.push(quote(part));
        }
        const inputs = parts.join(" ");
        const applied = await sandbox.exec(
          `cat ${inputs} | base64 -d > ${quote(file)} && ` +
            `git -C ${quote(workspace)} apply --whitespace=nowarn ${quote(file)} && ` +
            `rm -f -- ${quote(file)} ${inputs}`,
          commandOptions,
        );
        if (applied.timedOut || applied.exitCode !== 0)
          return {
            passed: false,
            exitCode: null,
            output: "",
            error: "Grading patch did not apply",
          };
      }
      const result = await sandbox.exec(task.verify, commandOptions);
      const exitCode = result.timedOut ? null : result.exitCode;
      return {
        passed: exitCode === 0,
        exitCode,
        output: result.stdout + result.stderr,
        ...(result.timedOut && { error: "Verification timed out" }),
      };
    } finally {
      await sandbox.destroy();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
