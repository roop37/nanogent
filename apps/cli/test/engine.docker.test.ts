import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MessagesClient } from "@nanogent/brain";
import { createRunId, type RunEvent, RunSpecSchema } from "@nanogent/core";
import { DockerSandboxProvider, docker } from "@nanogent/sandbox";
import { expect, it } from "vitest";
import { message, toolCall } from "../../../packages/core/test/runtime.js";
import { runCli } from "../src/index.js";

const available = await docker(["info", "--format", "{{.ServerVersion}}"], { timeoutSec: 5 })
  .then((r) => r.exitCode === 0)
  .catch(() => false);
const fixture = fileURLToPath(new URL("../../../tests/fixtures/repos/calc-bug", import.meta.url));
const fix =
  '  const amount = Number(input);\n  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");\n  return amount;';

it.skipIf(!available)(
  "full CLI path fixes calc-bug with a scripted model, independently verifies and cleans up",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "nanogent-docker-cli-"));
    const events: RunEvent[] = [];
    const responses = [
      message([toolCall("bash", { command: "node --test" }, "reproduce")]),
      message([
        toolCall(
          "str_replace_based_edit_tool",
          {
            command: "str_replace",
            path: "/workspace/index.js",
            old_str: "  return Number(input);",
            new_str: fix,
          },
          "fix",
        ),
      ]),
      message([
        toolCall("submit", { summary: "Reject negative and nonfinite amounts." }, "submit"),
      ]),
    ];
    const client: MessagesClient = {
      stream: () => ({
        finalMessage: async () => {
          const response = responses.shift();
          if (!response) throw new Error("Script exhausted");
          return response;
        },
      }),
    };
    try {
      const code = await runCli(
        [
          "run",
          "--repo",
          fixture,
          "--task",
          "Fix amount validation",
          "--verify",
          "node --test",
          "--json",
        ],
        {
          env: { NANOGENT_HOME: home, NANOGENT_ENV: "test" },
          client,
          write: (text) => {
            events.push(JSON.parse(text));
          },
        },
      );
      const result = events.find((e) => e.type === "run.result");
      expect(result, JSON.stringify(events)).toMatchObject({
        type: "run.result",
        data: { status: "completed", verified: true, verify: { exitCode: 0 } },
      });
      expect(code).toBe(0);
      if (result?.type !== "run.result") throw new Error("Missing result");
      expect(result.data.diff).toContain("Number.isFinite");
      expect(events.find((e) => e.type === "tool.result")).toMatchObject({
        data: { isError: true },
      });
      const id = events[0]?.runId;
      expect(
        (await docker(["ps", "-aq", "--filter", `label=nanogent.run=${id}`])).stdout.trim(),
      ).toBe("");
      expect(
        (
          await docker(["volume", "ls", "-q", "--filter", `label=nanogent.run=${id}`])
        ).stdout.trim(),
      ).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
it.skipIf(!available)(
  "enforces isolation, persistent shell recovery, path confinement and complete diff",
  async () => {
    const provider = new DockerSandboxProvider();
    const spec = RunSpecSchema.parse({
      id: createRunId(),
      repo: { localPath: fixture },
      task: "test",
      model: "claude-haiku-5-5",
      effort: "medium",
      setupCommands: ["printf setup > setup.txt"],
    });
    const sandbox = await provider.create(spec);
    const options = { timeoutSec: 5, maxOutputBytes: 2000 };
    try {
      const inspect = await docker([
        "inspect",
        "--format",
        "{{json .HostConfig}}|{{json .NetworkSettings.Networks}}",
        sandbox.id,
      ]);
      expect(inspect.stdout).toContain('"ReadonlyRootfs":true');
      expect(inspect.stdout).toContain('"CapDrop":["ALL"]');
      expect(inspect.stdout.trim()).toMatch(/\|\{\}$/);
      expect((await sandbox.exec("id -u", options)).stdout.trim()).toBe("1000");
      expect((await sandbox.exec("touch /root/forbidden", options)).exitCode).not.toBe(0);
      await sandbox.bash("export NANOGENT_TEST_VALUE=kept; cd /tmp", options);
      expect(
        (await sandbox.bash('printf "%s:%s" "$NANOGENT_TEST_VALUE" "$PWD"', options)).stdout,
      ).toBe("kept:/tmp");
      const timed = await sandbox.bash("sleep 20", { ...options, timeoutSec: 0.05 });
      expect(timed.timedOut).toBe(true);
      expect(timed.stdout).toContain("restarted");
      expect((await sandbox.bash("pwd", options)).stdout.trim()).toBe("/workspace");
      const oversized = await sandbox.exec("python3 -c 'print(\"a\" * 1000000)'", {
        ...options,
        maxOutputBytes: 100,
      });
      expect(oversized.truncated).toBe(true);
      expect(Buffer.byteLength(oversized.stdout)).toBeLessThanOrEqual(100);
      await sandbox.exec(
        "ln -s /etc /workspace/escape; ln -s /etc/passwd /workspace/file-escape",
        options,
      );
      for (const path of [
        "../../etc/passwd",
        "/workspace/escape/passwd",
        "/workspace/file-escape",
        "%2e%2e/secret",
      ]) {
        await expect(sandbox.readFile(path, { maxBytes: 2000 })).rejects.toThrow();
        await expect(sandbox.writeFile(path, "bad")).rejects.toThrow();
      }
      await sandbox.writeFile("/workspace/new.txt", "new file");
      const diff = await sandbox.diff({ maxBytes: 20_000 });
      expect(diff).toContain("new file");
      expect(diff).not.toContain("+setup");
      await sandbox.bash(undefined, { ...options, restart: true });
      expect((await sandbox.exec("printenv NANOGENT_ANTHROPIC_API_KEY", options)).stdout).toBe("");
    } finally {
      await sandbox.destroy();
    }
    await sandbox.destroy();
  },
);
it.skipIf(!available)("cleans up failed setup and reclaims labeled sandboxes", async () => {
  const provider = new DockerSandboxProvider();
  const spec = RunSpecSchema.parse({
    id: createRunId(),
    repo: { localPath: fixture },
    task: "test",
    model: "claude-haiku-5-5",
    effort: "medium",
    setupCommands: ["exit 7"],
  });
  await expect(provider.create(spec)).rejects.toThrow();
  expect(
    (await docker(["ps", "-aq", "--filter", `label=nanogent.run=${spec.id}`])).stdout.trim(),
  ).toBe("");
  const sandbox = await provider.create({ ...spec, id: createRunId(), setupCommands: [] });
  try {
    expect(await provider.gc(0, sandbox.id.slice("nanogent-".length))).toBe(1);
  } finally {
    await sandbox.destroy();
  }
});
