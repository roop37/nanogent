import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { capOutput } from "@nanogent/core";
import { afterEach, expect, it, vi } from "vitest";
import { runtime } from "../../../core/test/runtime.js";
import { builtInTools, PermissionPolicy, ToolRegistry, workspacePath } from "../../src/index.js";

const temp: string[] = [];
afterEach(async () => {
  for (const path of temp.splice(0)) await rm(path, { recursive: true, force: true });
});
it.each([
  "../../etc/passwd",
  "/etc/passwd",
  "/workspace-other/file",
  "%2e%2e/secret",
  "x\0y",
])("blocks path traversal %s", async (path) => {
  const { ctx, sandbox } = runtime();
  const registry = new ToolRegistry(builtInTools(), new PermissionPolicy(ctx.spec.policy));
  await expect(
    registry.execute(
      "str_replace_based_edit_tool",
      { command: "create", path, file_text: "bad" },
      ctx,
    ),
  ).rejects.toThrow();
  expect(sandbox.writeFile).not.toHaveBeenCalled();
  expect(() => workspacePath(path)).toThrow();
});
it("rejects symlink escape with the production descriptor traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanogent-path-test-"));
  temp.push(root);
  const outside = join(root, "outside");
  await writeFile(outside, "private");
  await symlink(outside, join(root, "escape"));
  // Exercise the O_NOFOLLOW primitive on the host; Docker tests cover /workspace wiring.
  await expect(
    promisify(execFile)("python3", [
      "-c",
      "import os,sys; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); os.open('escape',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)",
      root,
    ]),
  ).rejects.toThrow();
});
it("blocks forbidden tools and invalid input before execution", async () => {
  const { ctx, sandbox } = runtime();
  const registry = new ToolRegistry(
    builtInTools(),
    new PermissionPolicy({ ...ctx.spec.policy, tools: { bash: "deny" } }),
  );
  await expect(registry.execute("bash", { command: "pwd" }, ctx)).rejects.toThrow("denied");
  await expect(registry.execute("bash", { command: 42 }, ctx)).rejects.toThrow("Invalid");
  await expect(registry.execute("external", {}, ctx)).rejects.toThrow("Unknown");
  expect(sandbox.bash).not.toHaveBeenCalled();
});
it("caps oversized output by UTF-8 bytes with head and tail", async () => {
  const { ctx, sandbox } = runtime();
  vi.mocked(sandbox.bash).mockResolvedValue({
    exitCode: 0,
    stdout: `HEAD${"ü".repeat(100_000)}TAIL`,
    stderr: "",
    timedOut: false,
    truncated: false,
  });
  const registry = new ToolRegistry(builtInTools(), new PermissionPolicy(ctx.spec.policy));
  const output = await registry.execute("bash", { command: "output" }, ctx);
  expect(Buffer.byteLength(output)).toBeLessThanOrEqual(ctx.limits.maxToolOutputBytes);
  expect(output).toContain("[truncated]");
  expect(output).toContain("HEAD");
  expect(output).toContain("TAIL");
  for (let cap = 1; cap < 100; cap++)
    expect(Buffer.byteLength(capOutput("😀".repeat(100), cap).text)).toBeLessThanOrEqual(cap);
});
it("reports timeout as a tool failure", async () => {
  const { ctx, sandbox } = runtime();
  vi.mocked(sandbox.bash).mockResolvedValue({
    exitCode: null,
    stdout: "Bash session terminated and restarted.",
    stderr: "",
    timedOut: true,
    truncated: false,
  });
  await expect(
    new ToolRegistry(builtInTools(), new PermissionPolicy(ctx.spec.policy)).execute(
      "bash",
      { command: "sleep 9" },
      ctx,
    ),
  ).rejects.toThrow("restarted");
  expect(sandbox.bash).toHaveBeenCalledWith(
    "sleep 9",
    expect.objectContaining({ timeoutSec: ctx.limits.commandTimeoutSec }),
  );
});
it("blocks execution once budget is breached", async () => {
  const { ctx, sandbox } = runtime();
  ctx.budget.recordUsage({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: ctx.limits.maxCostUsd,
  });
  await expect(
    new ToolRegistry(builtInTools(), new PermissionPolicy(ctx.spec.policy)).execute(
      "bash",
      { command: "pwd" },
      ctx,
    ),
  ).rejects.toThrow("Budget");
  expect(sandbox.bash).not.toHaveBeenCalled();
});
it("defaults network and external tools to deny, and gates ask decisions", async () => {
  const { ctx, sandbox } = runtime();
  for (const risk of ["network", "external"] as const) {
    const bash = builtInTools()[0];
    if (!bash) throw new Error("Missing bash tool");
    const tool = { ...bash, risk };
    await expect(
      new ToolRegistry([tool], new PermissionPolicy(ctx.spec.policy)).execute(
        "bash",
        { command: "pwd" },
        ctx,
      ),
    ).rejects.toThrow("denied");
  }
  const policy = new PermissionPolicy({ ...ctx.spec.policy, tools: { bash: "ask" } });
  await expect(
    new ToolRegistry(builtInTools(), policy, async () => "deny").execute(
      "bash",
      { command: "pwd" },
      ctx,
    ),
  ).rejects.toThrow("denied");
  expect(sandbox.bash).not.toHaveBeenCalled();
  await new ToolRegistry(builtInTools(), policy, async () => "allow").execute(
    "bash",
    { command: "pwd" },
    ctx,
  );
  expect(sandbox.bash).toHaveBeenCalledOnce();
});
it("confines editor paths to the hosted workspace", async () => {
  const workspace = "/home/daytona/workspace";
  const { ctx, sandbox } = runtime();
  const registry = new ToolRegistry(builtInTools(workspace), new PermissionPolicy(ctx.spec.policy));
  await registry.execute(
    "str_replace_based_edit_tool",
    { command: "create", path: "new.ts", file_text: "ok" },
    ctx,
  );
  expect(sandbox.writeFile).toHaveBeenCalledWith(`${workspace}/new.ts`, "ok", ctx.signal);
  for (const path of ["../../secret", "/workspace/file", "/home/daytona/workspace-other/file"])
    expect(() => workspacePath(path, workspace)).toThrow();
});
