import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRequest, MessagesClient } from "@nanogent/brain";
import { afterEach, expect, it } from "vitest";
import { message, runtime, toolCall } from "../../../packages/core/test/runtime.js";
import { runCli } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "nanogent-cli-"));
  dirs.push(home);
  const { sandbox } = runtime();
  const output: string[] = [];
  const requests: MessageRequest[] = [];
  const client: MessagesClient = {
    stream: (request) => {
      requests.push(request);
      return { finalMessage: async () => message([toolCall("submit", { summary: "done" })]) };
    },
  };
  return {
    sandbox,
    output,
    requests,
    deps: {
      env: { NANOGENT_HOME: home },
      client,
      provider: { create: async () => sandbox },
      write: (text: string) => {
        output.push(text);
      },
    },
  };
}
it("parses overrides, runs without a real key, emits JSON events, then shows and lists", async () => {
  const { deps, output, requests } = await setup();
  expect(
    await runCli(
      [
        "run",
        "--repo",
        "/fixture",
        "--task",
        "fix",
        "--verify",
        "node --test",
        "--setup",
        "first",
        "--setup",
        "second",
        "--model",
        "claude-opus-5-5",
        "--effort",
        "low",
        "--fallback",
        "on",
        "--max-cost",
        "0.5",
        "--max-turns",
        "10",
        "--json",
      ],
      deps,
    ),
  ).toBe(0);
  const events = output.map((line) => JSON.parse(line));
  const id = events[0].runId;
  expect(events[0].data.spec).toMatchObject({
    setupCommands: ["first", "second"],
    limits: { maxCostUsd: 0.5, maxTurns: 10 },
  });
  expect(requests[0]).toMatchObject({
    model: "claude-opus-5-5",
    output_config: { effort: "low" },
    fallbacks: "default",
  });
  output.length = 0;
  expect(await runCli(["show", id, "--json"], deps)).toBe(0);
  expect(JSON.parse(output[0] ?? "").result.verified).toBe(true);
  output.length = 0;
  await runCli(["list"], deps);
  expect(output.join("")).toContain(id);
});
it("exits nonzero for unverified completion", async () => {
  const { deps, output } = await setup();
  expect(await runCli(["run", "--repo", "/fixture", "--task", "fix"], deps)).toBe(1);
  expect(output.join("")).toContain("UNVERIFIED");
});
it("requires a runtime key only for a live run and rejects invalid flags", async () => {
  const { deps } = await setup();
  await expect(
    runCli(["run", "--repo", "/fixture", "--task", "fix"], { env: deps.env }),
  ).rejects.toThrow("NANOGENT_ANTHROPIC_API_KEY");
  await expect(
    runCli(["run", "--repo", "/fixture", "--task", "fix", "--fallback", "yes"], deps),
  ).rejects.toThrow("refusalFallback");
  await expect(runCli(["run", "--unknown"], deps)).rejects.toThrow();
});
