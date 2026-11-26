import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CreateSandboxFromSnapshotParams,
  Daytona,
  type Sandbox as RemoteSandbox,
} from "@daytonaio/sdk";
import {
  capOutput,
  type EventSink,
  type ExecOptions,
  type ExecResult,
  ExecResultSchema,
  RunIdSchema,
  RunSpecSchema,
  type Sandbox,
  type SandboxProvider,
  type SandboxSpec,
} from "@nanogent/core";
import { quote } from "./process.js";

export type DaytonaHandle = Pick<
  RemoteSandbox,
  "id" | "labels" | "createdAt" | "updateNetworkSettings" | "delete"
> & {
  process: Pick<
    RemoteSandbox["process"],
    "executeCommand" | "createSession" | "executeSessionCommand" | "deleteSession"
  >;
  fs: Pick<RemoteSandbox["fs"], "uploadFile">;
};
export interface DaytonaClient {
  create(
    params: CreateSandboxFromSnapshotParams,
    options?: { timeout?: number },
  ): Promise<DaytonaHandle>;
  list(): AsyncIterable<DaytonaHandle>;
}
export interface DaytonaOptions {
  client?: DaytonaClient;
  apiKey?: string;
  environment: "development" | "test" | "production";
  allowRestrictedTierNetwork?: boolean;
  events: EventSink;
  snapshot?: string;
  user?: string;
  workspace?: string;
  helperDirectory?: string;
}
const defaultWorkspace = "/home/daytona/workspace";
const success = (result: ExecResult) => {
  if (result.exitCode !== 0 || result.timedOut)
    throw new Error(`Sandbox command failed: ${result.stdout}`);
  return result.stdout;
};
const status = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return value.status ?? value.statusCode ?? value.response?.status;
};
export function isTransientDaytonaError(error: unknown): boolean {
  return [429, 502, 503, 504].includes(status(error) ?? 0);
}

export class DaytonaSandboxProvider implements SandboxProvider {
  readonly client: DaytonaClient;
  constructor(private readonly options: DaytonaOptions) {
    if (!options.client && !options.apiKey?.trim()) throw new Error("DAYTONA_API_KEY is required");
    this.client =
      options.client ?? new Daytona({ apiKey: options.apiKey as string, requestTimeoutMs: 20_000 });
  }
  async create(input: SandboxSpec, signal?: AbortSignal): Promise<DaytonaSandbox> {
    const spec = RunSpecSchema.pick({
      id: true,
      repo: true,
      setupCommands: true,
      limits: true,
    }).parse(input);
    signal?.throwIfAborted();
    if ("url" in spec.repo) {
      const url = new URL(spec.repo.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error("Only credential-free HTTPS repositories are supported");
    }
    const workspace = this.options.workspace ?? defaultWorkspace;
    if (!/^\/[a-zA-Z0-9/_-]+$/.test(workspace) || workspace.includes("..") || workspace === "/")
      throw new Error("Invalid workspace directory");
    const remote = await this.client.create(
      {
        labels: { "nanogent.run": spec.id },
        public: false,
        ephemeral: true,
        autoStopInterval: 5,
        autoDeleteInterval: 0,
        ttlMinutes: Math.ceil(spec.limits.maxWallClockSec / 60) + 5,
        ...(this.options.snapshot ? { snapshot: this.options.snapshot } : {}),
        ...(this.options.user ? { user: this.options.user } : {}),
      },
      { timeout: 60 },
    );
    const sandbox = new DaytonaSandbox(
      remote,
      workspace,
      spec.limits.commandTimeoutSec,
      this.options.helperDirectory,
    );
    try {
      signal?.throwIfAborted();
      await sandbox.initialize(signal);
      const options = {
        timeoutSec: spec.limits.commandTimeoutSec,
        maxOutputBytes: spec.limits.maxToolOutputBytes,
        ...(signal && { signal }),
      };
      if ("url" in spec.repo) {
        success(
          await sandbox.exec(
            `git clone --no-recurse-submodules -c core.hooksPath=/dev/null -- ${quote(spec.repo.url)} .`,
            options,
          ),
        );
      } else {
        await sandbox.upload(spec.repo.localPath, signal);
      }
      success(
        await sandbox.exec(
          "git -c core.hooksPath=/dev/null init && git config core.hooksPath /dev/null",
          options,
        ),
      );
      if (spec.repo.ref) {
        if (spec.repo.ref.startsWith("-")) throw new Error("Invalid repository ref");
        success(
          await sandbox.exec(
            `git -c core.hooksPath=/dev/null checkout --detach ${quote(spec.repo.ref)} --`,
            options,
          ),
        );
      }
      for (const command of spec.setupCommands) success(await sandbox.exec(command, options));
      try {
        await remote.updateNetworkSettings({ networkBlockAll: true });
      } catch (error) {
        const restricted =
          status(error) === 400 &&
          error instanceof Error &&
          error.message.includes(
            "Network access is restricted and cannot be overridden at the sandbox level",
          );
        const allowed =
          this.options.allowRestrictedTierNetwork ?? this.options.environment !== "production";
        if (!restricted || !allowed) throw new Error("Daytona agent network isolation failed");
        await this.options.events.emit({
          type: "log",
          data: {
            level: "warn",
            message:
              "Daytona restricted tier: egress remains limited to essential services, including git hosts and package registries. Public repositories only.",
          },
        });
      }
      success(
        await sandbox.exec(
          "git -c core.hooksPath=/dev/null add -A && git -c core.hooksPath=/dev/null -c user.name=nanogent-baseline -c user.email=baseline@nanogent.local commit --allow-empty --no-gpg-sign -m nanogent-baseline",
          options,
        ),
      );
      sandbox.baseline = success(await sandbox.exec("git rev-parse HEAD", options)).trim();
      if (!/^[a-f0-9]{40,64}$/.test(sandbox.baseline)) throw new Error("Invalid baseline commit");
      signal?.throwIfAborted();
      return sandbox;
    } catch (error) {
      await sandbox.destroy();
      throw error;
    }
  }
  async gc(maxAgeSec: number): Promise<number> {
    if (!Number.isFinite(maxAgeSec) || maxAgeSec < 0) throw new Error("Invalid GC age");
    let count = 0;
    for await (const sandbox of this.client.list()) {
      if (
        RunIdSchema.safeParse(sandbox.labels["nanogent.run"]).success &&
        sandbox.createdAt &&
        Date.now() - Date.parse(sandbox.createdAt) >= maxAgeSec * 1000
      ) {
        await sandbox.delete(20);
        count++;
      }
    }
    return count;
  }
}

export class DaytonaSandbox implements Sandbox {
  readonly id: string;
  baseline = "";
  private readonly helper: string;
  private session: string | undefined;
  private busy = false;
  private destroyed = false;
  constructor(
    private readonly remote: DaytonaHandle,
    readonly workspace = defaultWorkspace,
    private readonly timeoutSec = 300,
    private readonly helperDirectory?: string,
  ) {
    this.id = remote.id;
    this.helper = `/tmp/nanogent-${crypto.randomUUID()}`;
  }
  private command(source: string, cwd = this.workspace): string {
    return `cd ${quote(cwd)} && env -i PATH="$PATH" HOME=/tmp GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null ${source}`;
  }
  async initialize(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const result = await this.remote.process.executeCommand(
      `mkdir -p ${quote(this.helper)} ${quote(this.workspace)}`,
      "/tmp",
      undefined,
      20,
    );
    if (result.exitCode !== 0) throw new Error("Sandbox initialization failed");
    for (const file of ["shell.py", "fs.py", "daytona-shell.py"]) {
      signal?.throwIfAborted();
      await this.remote.fs.uploadFile(
        await readFile(
          this.helperDirectory
            ? join(this.helperDirectory, file)
            : new URL(`../docker/${file}`, import.meta.url),
        ),
        `${this.helper}/${file}`,
        30,
      );
    }
  }
  async upload(localPath: string, signal?: AbortSignal) {
    const root = await realpath(resolve(localPath));
    if (!(await lstat(root)).isDirectory()) throw new Error("Local repository must be a directory");
    let total = 0;
    const walk = async (dir: string, relative: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (
          [".ssh", ".aws", ".config", "node_modules", ".nanogent"].includes(entry.name) ||
          entry.name.startsWith(".env")
        )
          continue;
        if (entry.name === ".git" && !entry.isDirectory()) continue;
        if (
          relative.endsWith("/.git") &&
          ["config", "hooks", "worktrees", "modules"].includes(entry.name)
        )
          continue;
        const path = join(dir, entry.name);
        const target = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error("Local upload does not accept symlinks");
        if (entry.isDirectory()) {
          success(
            await this.exec(`mkdir -p -- ${quote(target)}`, {
              timeoutSec: 20,
              maxOutputBytes: 1000,
              ...(signal && { signal }),
            }),
          );
          await walk(path, target);
        } else if (entry.isFile()) {
          const file = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            const stat = await file.stat();
            if (!stat.isFile()) throw new Error("Only regular files can be uploaded");
            total += stat.size;
            if (stat.size > 10_000_000 || total > 100_000_000)
              throw new Error("Local upload exceeds size limit");
            const bytes = Buffer.alloc(stat.size + 1);
            let length = 0;
            while (length < bytes.length) {
              const { bytesRead } = await file.read(bytes, length, bytes.length - length);
              if (!bytesRead) break;
              length += bytesRead;
            }
            if (length > stat.size) throw new Error("Local file changed during upload");
            await this.remote.fs.uploadFile(bytes.subarray(0, length), target, 30);
            success(
              await this.exec(
                `chmod ${(stat.mode & 0o111 ? 0o755 : 0o644).toString(8)} -- ${quote(target)}`,
                { timeoutSec: 20, maxOutputBytes: 1000, ...(signal && { signal }) },
              ),
            );
          } finally {
            await file.close();
          }
        } else throw new Error("Only regular files can be uploaded");
      }
    };
    await walk(root, this.workspace);
  }
  private async restart() {
    if (this.session) await this.remote.process.deleteSession(this.session);
    this.session = `nanogent-${crypto.randomUUID()}`;
    await this.remote.process.createSession(this.session);
    await this.remote.process.executeSessionCommand(
      this.session,
      {
        command: this.command(`python3 -u ${quote(`${this.helper}/daytona-shell.py`)} serve`),
        runAsync: true,
      },
      10,
    );
  }
  private async execute(
    command: string | undefined,
    options: ExecOptions,
    persistent: boolean,
    restart = false,
  ): Promise<ExecResult> {
    options.signal?.throwIfAborted();
    if (this.destroyed) throw new Error("Sandbox destroyed");
    if (
      !Number.isFinite(options.timeoutSec) ||
      options.timeoutSec <= 0 ||
      !Number.isSafeInteger(options.maxOutputBytes) ||
      options.maxOutputBytes < 1
    )
      throw new Error("Invalid execution limits");
    if (persistent && this.busy) throw new Error("Bash session is busy");
    if (persistent) this.busy = true;
    let abort: (() => void) | undefined;
    try {
      if (persistent && !this.session) await this.restart();
      const request = Buffer.from(
        JSON.stringify({
          command,
          timeoutSec: options.timeoutSec,
          maxOutputBytes: options.maxOutputBytes,
          restart,
        }),
      ).toString("base64");
      const operation = this.remote.process.executeCommand(
        this.command(
          `python3 ${quote(`${this.helper}/daytona-shell.py`)} ${persistent ? "request" : "once"} ${quote(request)}`,
        ),
        this.workspace,
        undefined,
        Math.ceil(options.timeoutSec) + 10,
      );
      const canceled = new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Sandbox execution canceled"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
      const response = await Promise.race([operation, canceled]);
      if (response.exitCode !== 0) throw new Error("Sandbox execution transport failed");
      const result = ExecResultSchema.parse(JSON.parse(response.result));
      if (Buffer.byteLength(result.stdout + result.stderr) > options.maxOutputBytes)
        throw new Error("Sandbox output exceeded limit");
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        await this.destroy();
        options.signal.throwIfAborted();
      }
      if (persistent) {
        await this.restart();
        const output = capOutput(
          "Bash transport failed; session terminated and restarted.",
          options.maxOutputBytes,
        );
        return {
          exitCode: null,
          stdout: output.text,
          stderr: "",
          timedOut: true,
          truncated: output.truncated,
        };
      }
      throw error;
    } finally {
      if (abort) options.signal?.removeEventListener("abort", abort);
      if (persistent) this.busy = false;
    }
  }
  exec(command: string, options: ExecOptions) {
    return this.execute(command, options, false);
  }
  bash(command: string | undefined, options: ExecOptions & { restart?: boolean }) {
    return this.execute(command, options, true, options.restart);
  }
  private async file(request: object, maxBytes: number, signal?: AbortSignal) {
    const data = Buffer.from(JSON.stringify(request)).toString("base64");
    const result = await this.exec(
      `python3 ${quote(`${this.helper}/fs.py`)} ${quote(data)} ${quote(this.workspace)}`,
      {
        timeoutSec: this.timeoutSec,
        maxOutputBytes: maxBytes,
        ...(signal && { signal }),
      },
    );
    if (result.exitCode !== 0 || result.timedOut || result.truncated)
      throw new Error("Confined file operation failed");
    return result.stdout;
  }
  readFile(path: string, options: { maxBytes: number; signal?: AbortSignal }) {
    return this.file(
      { op: "read", path, maxBytes: options.maxBytes },
      options.maxBytes,
      options.signal,
    );
  }
  async writeFile(path: string, content: string, signal?: AbortSignal) {
    await this.file({ op: "write", path, content }, 3000, signal);
  }
  async diff(options: { maxBytes: number; signal?: AbortSignal }) {
    return success(
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
  async destroy() {
    if (this.destroyed) return;
    try {
      await this.remote.delete(20);
    } catch (error) {
      if (status(error) !== 404) throw new Error("Daytona cleanup failed; run gc");
    }
    this.destroyed = true;
  }
}
