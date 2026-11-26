import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { cp, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ExecOptions,
  type ExecResult,
  ExecResultSchema,
  RunIdSchema,
  type Sandbox,
  type SandboxProvider,
  type SandboxSpec,
} from "@nanogent/core";
import { docker, dockerEnv, quote } from "./process.js";

export { docker, quote } from "./process.js";

const image = "nanogent-sandbox:dev";
const context = fileURLToPath(new URL("../docker", import.meta.url));
const requireSuccess = (result: ExecResult) => {
  if (result.exitCode !== 0 || result.timedOut)
    throw new Error(`Sandbox command failed: ${result.stdout}`);
  return result.stdout;
};

export class DockerSandboxProvider implements SandboxProvider {
  async create(spec: SandboxSpec, signal?: AbortSignal): Promise<DockerSandbox> {
    RunIdSchema.parse(spec.id);
    const sandbox = new DockerSandbox(spec.id, spec.limits.commandTimeoutSec);
    try {
      signal?.throwIfAborted();
      if (
        (await docker(["image", "inspect", image], { ...(signal && { signal }) })).exitCode !== 0
      ) {
        requireSuccess(
          await docker(["build", "-t", image, context], {
            timeoutSec: spec.limits.maxWallClockSec,
            ...(signal && { signal }),
          }),
        );
      }
      requireSuccess(
        await docker(["volume", "create", "--label", `nanogent.run=${spec.id}`, sandbox.volume]),
      );
      requireSuccess(
        await docker(
          [
            "run",
            "-d",
            "--name",
            sandbox.id,
            "--label",
            `nanogent.run=${spec.id}`,
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "512",
            "--memory",
            "2g",
            "--cpus",
            "2",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=512m",
            "--mount",
            `type=volume,src=${sandbox.volume},dst=/workspace`,
            "--network",
            "bridge",
            "--init",
            image,
          ],
          { ...(signal && { signal }) },
        ),
      );
      const options = {
        timeoutSec: spec.limits.commandTimeoutSec,
        maxOutputBytes: spec.limits.maxToolOutputBytes,
        ...(signal && { signal }),
      };
      if ("url" in spec.repo) {
        const url = new URL(spec.repo.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
          throw new Error("Only credential-free HTTP(S) repositories are supported");
        requireSuccess(
          await sandbox.exec(
            `git clone --no-recurse-submodules -c core.hooksPath=/dev/null -- ${quote(spec.repo.url)} /workspace`,
            options,
          ),
        );
      } else {
        const source = await realpath(resolve(spec.repo.localPath));
        if (!(await stat(source)).isDirectory())
          throw new Error("Local repository must be a directory");
        const stage = await mkdtemp(join(tmpdir(), "nanogent-source-"));
        try {
          await cp(source, join(stage, "repo"), {
            recursive: true,
            dereference: false,
            filter: (path) => {
              const name = basename(path);
              return (
                ![".ssh", ".aws", ".config", "node_modules", ".nanogent"].includes(name) &&
                !name.startsWith(".env") &&
                !path.includes("/.git/hooks") &&
                !path.endsWith("/.git/config")
              );
            },
          });
          await promisify(execFile)(
            "tar",
            ["-cf", join(stage, "source.tar"), "-C", join(stage, "repo"), "."],
            { env: dockerEnv(), ...(signal && { signal }) },
          );
          requireSuccess(
            await docker(
              [
                "exec",
                "-i",
                "--user",
                "agent",
                sandbox.id,
                "tar",
                "-xf",
                "-",
                "--no-same-owner",
                "-C",
                "/workspace",
              ],
              { inputFile: join(stage, "source.tar"), ...(signal && { signal }) },
            ),
          );
        } finally {
          await rm(stage, { recursive: true, force: true });
        }
      }
      requireSuccess(
        await sandbox.exec(
          "git -c core.hooksPath=/dev/null init && git config core.hooksPath /dev/null",
          options,
        ),
      );
      if (spec.repo.ref)
        requireSuccess(
          await sandbox.exec(
            `git -c core.hooksPath=/dev/null checkout --detach ${quote(spec.repo.ref)} --`,
            options,
          ),
        );
      for (const command of spec.setupCommands)
        requireSuccess(await sandbox.exec(command, options));
      requireSuccess(
        await docker(["network", "disconnect", "bridge", sandbox.id], {
          ...(signal && { signal }),
        }),
      );
      requireSuccess(
        await sandbox.exec(
          "git -c core.hooksPath=/dev/null add -A && if ! git rev-parse --verify HEAD >/dev/null 2>&1 || ! git diff --cached --quiet; then git -c core.hooksPath=/dev/null -c user.name=nanogent-baseline -c user.email=baseline@nanogent.local commit --no-gpg-sign -m nanogent-baseline; fi",
          options,
        ),
      );
      sandbox.baseline = requireSuccess(await sandbox.exec("git rev-parse HEAD", options)).trim();
      if (!/^[a-f0-9]{40,64}$/.test(sandbox.baseline)) throw new Error("Invalid baseline commit");
      return sandbox;
    } catch (error) {
      await sandbox.destroy();
      throw error;
    }
  }

  async gc(maxAgeSec: number, runId?: string): Promise<number> {
    if (!Number.isFinite(maxAgeSec) || maxAgeSec < 0) throw new Error("Invalid GC age");
    const ids = requireSuccess(
      await docker([
        "ps",
        "-aq",
        "--filter",
        runId ? `label=nanogent.run=${RunIdSchema.parse(runId)}` : "label=nanogent.run",
      ]),
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let count = 0;
    for (const id of ids) {
      const raw = requireSuccess(
        await docker([
          "inspect",
          "--format",
          '{{.Created}}|{{index .Config.Labels "nanogent.run"}}',
          id,
        ]),
      ).trim();
      const [created, runId] = raw.split("|");
      if (
        created &&
        runId &&
        RunIdSchema.safeParse(runId).success &&
        Date.now() - Date.parse(created) >= maxAgeSec * 1000
      ) {
        await new DockerSandbox(runId).destroy();
        count++;
      }
    }
    return count;
  }
}

export class DockerSandbox implements Sandbox {
  readonly id: string;
  readonly volume: string;
  baseline = "";
  #shell: ChildProcessWithoutNullStreams | undefined;
  #busy = false;
  constructor(
    runId: string,
    private readonly timeoutSec = 300,
  ) {
    RunIdSchema.parse(runId);
    this.id = `nanogent-${runId}`;
    this.volume = `${this.id}-workspace`;
  }
  async exec(command: string, options: ExecOptions): Promise<ExecResult> {
    const result = await docker(
      ["exec", "-i", "--user", "agent", this.id, "python3", "-u", "/opt/nanogent/shell.py"],
      {
        timeoutSec: options.timeoutSec + 5,
        maxBytes: options.maxOutputBytes * 6 + 2000,
        ...(options.signal && { signal: options.signal }),
        input: `${JSON.stringify({ command, ...options, signal: undefined })}\n`,
      },
    );
    options.signal?.throwIfAborted();
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("Sandbox execution transport failed");
    return ExecResultSchema.parse(JSON.parse(result.stdout));
  }
  async bash(
    command: string | undefined,
    options: ExecOptions & { restart?: boolean },
  ): Promise<ExecResult> {
    options.signal?.throwIfAborted();
    if (this.#busy) throw new Error("Bash session is busy");
    this.#busy = true;
    try {
      const child =
        this.#shell ??
        spawn(
          "docker",
          ["exec", "-i", "--user", "agent", this.id, "python3", "-u", "/opt/nanogent/shell.py"],
          { env: dockerEnv() },
        );
      this.#shell = child;
      child.stdin.on("error", () => {});
      return await new Promise<ExecResult>((resolve, reject) => {
        let response = "";
        const finish = (error?: Error, value?: ExecResult) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          child.stdout.off("data", data);
          child.off("error", failed);
          child.off("close", closed);
          if (error) {
            child.kill("SIGKILL");
            this.#shell = undefined;
            reject(error);
          } else if (value) resolve(value);
        };
        const abort = () => finish(new Error("Bash canceled"));
        const failed = () => finish(new Error("Bash transport failed"));
        const closed = () => finish(new Error("Bash session closed"));
        const data = (chunk: Buffer) => {
          response += chunk.toString();
          if (response.length > options.maxOutputBytes * 6 + 2000)
            return finish(new Error("Bash transport output exceeded limit"));
          if (response.includes("\n")) {
            try {
              finish(undefined, ExecResultSchema.parse(JSON.parse(response)));
            } catch {
              finish(new Error("Invalid Bash response"));
            }
          }
        };
        const timer = setTimeout(failed, (options.timeoutSec + 5) * 1000);
        options.signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", data);
        child.on("error", failed);
        child.on("close", closed);
        child.stdin.write(`${JSON.stringify({ command, ...options, signal: undefined })}\n`);
      });
    } finally {
      this.#busy = false;
    }
  }
  async readFile(
    path: string,
    options: { maxBytes: number; signal?: AbortSignal },
  ): Promise<string> {
    return this.file(
      { op: "read", path, maxBytes: options.maxBytes },
      options.maxBytes,
      options.signal,
    );
  }
  async writeFile(path: string, content: string, signal?: AbortSignal): Promise<void> {
    await this.file({ op: "write", path, content }, 3000, signal);
  }
  private async file(request: object, maxBytes: number, signal?: AbortSignal): Promise<string> {
    const data = Buffer.from(JSON.stringify(request)).toString("base64");
    const result = await this.exec(`python3 /opt/nanogent/fs.py ${quote(data)}`, {
      timeoutSec: this.timeoutSec,
      maxOutputBytes: maxBytes,
      ...(signal && { signal }),
    });
    if (result.exitCode !== 0 || result.timedOut || result.truncated)
      throw new Error(`Confined file operation failed: ${result.stdout}`);
    return result.stdout;
  }
  async diff(options: { maxBytes: number; signal?: AbortSignal }): Promise<string> {
    return requireSuccess(
      await this.exec(
        `git -c core.hooksPath=/dev/null add -N . && git -c core.hooksPath=/dev/null diff --no-ext-diff --no-textconv --binary ${quote(this.baseline)} --`,
        {
          timeoutSec: this.timeoutSec,
          maxOutputBytes: options.maxBytes,
          ...(options.signal && { signal: options.signal }),
        },
      ),
    );
  }
  async destroy(): Promise<void> {
    this.#shell?.stdin.end();
    this.#shell?.kill("SIGKILL");
    this.#shell = undefined;
    const removed = await docker(["rm", "-f", this.id], { timeoutSec: 20 });
    if (removed.exitCode !== 0 && !removed.stdout.includes("No such container"))
      throw new Error("Container cleanup failed");
    const volume = await docker(["volume", "rm", "-f", this.volume], { timeoutSec: 20 });
    if (volume.exitCode !== 0 && !volume.stdout.includes("no such volume"))
      throw new Error("Volume cleanup failed");
  }
}

export {
  type DaytonaClient,
  type DaytonaHandle,
  DaytonaSandbox,
  DaytonaSandboxProvider,
  isTransientDaytonaError,
} from "./daytona.js";
