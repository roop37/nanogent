import "server-only";
import type { RunEvent, RunEventInput, RunSpec } from "@nanogent/core";
import { active, type RunView } from "../types";
import type { Backend } from "./api";
import { testMode } from "./settings";

type Entry = { owner: string; run: RunView; events: RunEvent[]; started: number };
const globalState = globalThis as typeof globalThis & { nanogentWebFake?: Map<string, Entry> };
function emit(entry: Entry, input: RunEventInput) {
  entry.events.push({
    ...input,
    runId: entry.run.spec.id,
    seq: entry.events.length + 1,
    ts: new Date().toISOString(),
  } as RunEvent);
  entry.run.updatedAt = new Date().toISOString();
}
function advance(entry: Entry) {
  if (!active(entry.run.state) || Date.now() - entry.started < 5000) return;
  entry.run.state = "completed";
  const result = {
    status: "completed" as const,
    summary: "Fixed the addition function.",
    diff: "diff --git a/calc.js b/calc.js\n--- a/calc.js\n+++ b/calc.js\n@@ -1 +1 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n",
    verify: { command: "npm test", exitCode: 0, output: "1 test passed" },
    verified: true,
    usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.0001 },
    turns: 1,
    toolCalls: 1,
    durationMs: 5000,
  };
  entry.run.result = result;
  entry.run.progress = { turns: 1, toolCalls: 1, costUsd: result.usage.costUsd };
  emit(entry, {
    type: "model.response",
    data: { messageId: "scripted", model: entry.run.spec.model, usage: result.usage },
  });
  emit(entry, {
    type: "tool.call",
    data: {
      toolCallId: "edit-1",
      name: "str_replace_editor",
      risk: "write",
      input: { path: "calc.js", command: "str_replace" },
    },
  });
  emit(entry, {
    type: "tool.result",
    data: {
      toolCallId: "edit-1",
      output: "Updated calc.js",
      isError: false,
      truncated: false,
      durationMs: 10,
    },
  });
  emit(entry, { type: "verify.result", data: result.verify });
  emit(entry, { type: "run.result", data: result });
  emit(entry, { type: "run.state_changed", data: { from: "running", to: "completed" } });
}
export function fakeBackend(): Backend {
  if (!testMode()) throw new Error("Fake backend is disabled");
  globalState.nanogentWebFake ??= new Map();
  const entries = globalState.nanogentWebFake;
  return {
    list: async (owner) =>
      [...entries.values()]
        .filter((e) => e.owner === owner)
        .map((e) => {
          advance(e);
          return e.run;
        })
        .reverse(),
    get: async (owner, id) => {
      const e = entries.get(id);
      if (!e || e.owner !== owner) return undefined;
      advance(e);
      return e.run;
    },
    events: async (id, from) => {
      const e = entries.get(id);
      if (e) advance(e);
      const events = (e?.events ?? []).filter((event) => event.seq >= from);
      return { events, nextSeq: (events.at(-1)?.seq ?? from - 1) + 1, hasMore: false };
    },
    withOwnerLock: async (_owner, work) => work(),
    allowance: async (owner) => ({
      activeCount: [...entries.values()].filter((e) => e.owner === owner && active(e.run.state))
        .length,
      charged: [...entries.values()]
        .filter((e) => e.owner === owner)
        .reduce(
          (sum, e) =>
            sum +
            (active(e.run.state)
              ? e.run.spec.limits.maxCostUsd
              : (e.run.result?.usage.costUsd ?? 0)),
          0,
        ),
    }),
    submit: async (spec: RunSpec, owner) => {
      const now = new Date().toISOString();
      const e: Entry = {
        owner,
        run: {
          spec,
          state: "running",
          createdAt: now,
          updatedAt: now,
          cancelRequested: false,
          progress: { turns: 0, toolCalls: 0, costUsd: 0 },
        },
        events: [],
        started: Date.now(),
      };
      emit(e, { type: "run.created", data: { spec } });
      emit(e, { type: "run.state_changed", data: { from: "queued", to: "running" } });
      entries.set(spec.id, e);
      return spec.id;
    },
    cancel: async (id) => {
      const e = entries.get(id);
      if (e && active(e.run.state)) {
        emit(e, { type: "run.state_changed", data: { from: e.run.state, to: "canceled" } });
        e.run.state = "canceled";
        e.run.cancelRequested = true;
      }
    },
  };
}
