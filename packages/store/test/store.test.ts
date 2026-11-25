import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunEvent, RunEventSchema } from "@nanogent/core";
import { afterEach, expect, it } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { JsonlRunStore } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "nanogent-store-"));
  dirs.push(home);
  const store = new JsonlRunStore(home, ["synthetic-secret"]);
  const { spec } = runtime({ task: "Do not retain synthetic-secret or sk-ant-testvalue" });
  await store.create(spec);
  return { home, store, spec };
}
it("persists redacted spec, nested events, result and diff, and replays inclusive cursors", async () => {
  const { home, store, spec } = await setup();
  await store.setState(spec.id, "running");
  const event = RunEventSchema.parse({
    runId: spec.id,
    seq: 2,
    ts: new Date().toISOString(),
    type: "tool.call",
    data: {
      name: "bash",
      toolCallId: "t",
      risk: "exec",
      input: { nested: ["synthetic-secret", "Bearer token123"] },
    },
  });
  await store.append(event);
  const result = {
    status: "completed",
    summary: "synthetic-secret",
    diff: "+sk-ant-testvalue",
    verified: false,
    verify: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    turns: 1,
    toolCalls: 1,
    durationMs: 1,
  };
  await store.append(RunEventSchema.parse({ ...event, seq: 3, type: "run.result", data: result }));
  await store.setState(spec.id, "completed");
  const restarted = new JsonlRunStore(home);
  expect(await restarted.get(spec.id)).toMatchObject({
    state: "completed",
    result: { summary: "[REDACTED]", diff: "+[REDACTED]" },
  });
  const events: RunEvent[] = [];
  for await (const e of restarted.events(spec.id, 2)) events.push(e);
  expect(events.map((e) => e.seq)).toEqual([2, 3, 4]);
  expect(await restarted.list()).toHaveLength(1);
  for (const name of ["spec.json", "events.jsonl", "result.json", "diff.patch"]) {
    const text = await readFile(join(home, "runs", spec.id, name), "utf8");
    expect(text).not.toContain("synthetic-secret");
    expect(text).not.toContain("sk-ant-testvalue");
    expect(text).not.toContain("token123");
  }
});
it("rejects duplicate IDs, event gaps, stale transitions and terminal updates", async () => {
  const { store, spec } = await setup();
  await expect(store.create(spec)).rejects.toThrow();
  const event = RunEventSchema.parse({
    runId: spec.id,
    seq: 2,
    ts: new Date().toISOString(),
    type: "log",
    data: { level: "info", message: "hello" },
  });
  await expect(store.append(event)).rejects.toThrow("sequence");
  await store.setState(spec.id, "running");
  await store.append(event);
  await expect(store.append(event)).rejects.toThrow("sequence");
  await store.setState(spec.id, "failed");
  await expect(store.setState(spec.id, "running")).rejects.toThrow("Illegal");
  await expect(store.append({ ...event, seq: 4 })).rejects.toThrow("terminal");
  await expect(store.get("../../escape")).rejects.toThrow();
});
it("serializes competing state transitions", async () => {
  const { store, spec } = await setup();
  await store.setState(spec.id, "running");
  const results = await Promise.allSettled([
    store.setState(spec.id, "failed"),
    store.setState(spec.id, "completed"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
