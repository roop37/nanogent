import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const env = { PATH: process.env.PATH, HOME: "/tmp" };

it("preserves shell state, enforces timeout and caps output across the session bridge", async () => {
  const dir = await mkdtemp("/private/tmp/nanogent-shell-");
  for (const name of ["shell.py", "daytona-shell.py"])
    await copyFile(new URL(`../docker/${name}`, import.meta.url), join(dir, name));
  const bridge = join(dir, "daytona-shell.py");
  const server = spawn("python3", [bridge, "serve"], { cwd: dir, env, stdio: "ignore" });
  const stopped = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const command = async (command: string, timeoutSec = 1, maxOutputBytes = 1000) => {
    const data = Buffer.from(JSON.stringify({ command, timeoutSec, maxOutputBytes })).toString(
      "base64",
    );
    const { stdout } = await exec("python3", [bridge, "request", data], { env, timeout: 10_000 });
    return JSON.parse(stdout);
  };
  try {
    await command("export VALUE=kept; cd /tmp");
    expect((await command('printf "%s:%s" "$VALUE" "$PWD"')).stdout).toBe("kept:/tmp");
    const timeout = await command("sleep 60", 0.05);
    expect(timeout.timedOut).toBe(true);
    expect(timeout.stdout).toContain("restarted");
    expect((await command("printf alive")).stdout).toBe("alive");
    const output = await command('python3 -c \'print("HEAD" + "x" * 1000000 + "TAIL")\'', 1, 100);
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(100);
    expect(output.stdout).toContain("HEAD");
    expect(output.stdout).toContain("TAIL");
  } finally {
    server.kill("SIGTERM");
    await stopped;
    await rm(dir, { recursive: true, force: true });
  }
});
it("confines file operations to a configurable workspace, including symlink parents", async () => {
  const root = await mkdtemp("/private/tmp/nanogent-files-");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(root, "outside"), "outside");
  await symlink(root, join(workspace, "escape"));
  const file = async (request: object) => {
    const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
    return exec(
      "python3",
      [fileURLToPath(new URL("../docker/fs.py", import.meta.url)), encoded, workspace],
      { env },
    );
  };
  try {
    await file({ op: "write", path: "ok", content: "hello" });
    expect((await file({ op: "read", path: join(workspace, "ok"), maxBytes: 10 })).stdout).toBe(
      "hello",
    );
    for (const path of ["../outside", "escape/outside", "%2e%2e/outside", "/etc/passwd"])
      await expect(file({ op: "read", path, maxBytes: 100 })).rejects.toThrow();
    await expect(file({ op: "read", path: "ok", maxBytes: 2 })).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
