import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { capOutput, type ExecResult } from "@nanogent/core";

export const dockerEnv = () =>
  Object.fromEntries(
    [
      "PATH",
      "HOME",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_CONFIG",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
      "TMPDIR",
      "BUILDX_CONFIG",
    ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );

export async function docker(
  args: string[],
  options: {
    signal?: AbortSignal;
    timeoutSec?: number;
    maxBytes?: number;
    input?: string;
    inputFile?: string;
  } = {},
): Promise<ExecResult> {
  options.signal?.throwIfAborted();
  const max = options.maxBytes ?? 30_000;
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: dockerEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let total = 0;
    let timedOut = false;
    const collect = (data: Buffer) => {
      total += data.length;
      if (head.length < max) head = Buffer.concat([head, data.subarray(0, max - head.length)]);
      tail = Buffer.concat([tail, data]).subarray(-max);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => {
        timedOut = true;
        abort();
      },
      (options.timeoutSec ?? 300) * 1000,
    );
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const output = capOutput(
        total > max ? head.toString() + tail.toString() : head.toString(),
        max,
      );
      resolve({
        exitCode: code,
        stdout: output.text,
        stderr: "",
        timedOut,
        truncated: total > max,
      });
    });
    child.stdin.on("error", () => {});
    if (options.inputFile)
      createReadStream(options.inputFile).on("error", reject).pipe(child.stdin);
    else child.stdin.end(options.input);
  });
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
