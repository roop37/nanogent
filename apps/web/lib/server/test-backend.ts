import "server-only";
import type { RunEvent, RunEventInput, RunSpec } from "@nanogent/core";
import { active, type RunView } from "../types";
import type { Backend } from "./api";
import { demoRuns } from "./demo-runs";
import { testMode } from "./settings";

type Entry = { owner: string; run: RunView; events: RunEvent[]; scripted?: true };
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
function advance(entry: Entry, from: number) {
  if (!entry.scripted || !active(entry.run.state)) return;
  // Replaying a page after a reload or an interrupted response must not advance the run.
  if (entry.events.length === 2 && from === 1) {
    emit(entry, { type: "sandbox.ready", data: { sandboxId: "scripted" } });
    emit(entry, {
      type: "tool.call",
      data: { toolCallId: "test-1", name: "bash", risk: "exec", input: { command: "npm test" } },
    });
    return;
  }
  if (from !== entry.events.length + 1) return;
  if (entry.events.at(-1)?.type === "tool.call") {
    emit(entry, {
      type: "tool.result",
      data: {
        toolCallId: "test-1",
        output: Array.from(
          { length: 18 },
          (_, i) => `Test ${i + 1}: ${i === 17 ? "addition failed" : "passed"}`,
        ).join("\n"),
        isError: true,
        truncated: false,
        durationMs: 320,
      },
    });
    return;
  }
  if (entry.events.at(-1)?.type !== "tool.result") return;
  entry.run.state = "completed";
  const result = {
    status: "completed" as const,
    summary: "Fixed the addition function.",
    diff: "diff --git a/calc.js b/calc.js\n--- a/calc.js\n+++ b/calc.js\n@@ -1 +1 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n",
    verify: {
      command: entry.run.spec.verifyCommand ?? "npm test",
      exitCode: 0,
      output: "1 test passed",
      durationMs: 1240,
    },
    verified: true,
    usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.0001 },
    turns: 1,
    toolCalls: 2,
    durationMs: 5000,
  };
  entry.run.result = result;
  entry.run.progress = { turns: 1, toolCalls: result.toolCalls, costUsd: result.usage.costUsd };
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
      input: { path: "calc.js", command: "str_replace", old_str: "a - b", new_str: "a + b" },
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
  if (!globalState.nanogentWebFake) {
    globalState.nanogentWebFake = new Map();
    for (const run of demoRuns()) {
      const entry: Entry = {
        owner: "00000000-0000-4000-8000-000000000001",
        run,
        events: [],
      };
      const updated = run.updatedAt;
      const file = run.spec.task.includes("reconnects")
        ? "src/events.ts"
        : run.spec.task.includes("migration")
          ? "migrations/teams.sql"
          : run.spec.task.includes("metadata")
            ? "src/repository.ts"
            : run.spec.task.includes("line endings")
              ? "src/patch.ts"
              : run.spec.task.includes("timezone")
                ? "src/report.ts"
                : run.spec.task.includes("config")
                  ? "src/config.ts"
                  : "src/activity.ts";
      emit(entry, { type: "run.created", data: { spec: run.spec } });
      if (run.state !== "queued") {
        emit(entry, { type: "run.state_changed", data: { from: "queued", to: "running" } });
        emit(entry, { type: "sandbox.ready", data: { sandboxId: "demo-sandbox" } });
        emit(entry, {
          type: "tool.call",
          data: {
            toolCallId: "read-1",
            name: "bash",
            risk: "exec",
            input: { command: `cat ${file}` },
          },
        });
        emit(entry, {
          type: "tool.result",
          data: {
            toolCallId: "read-1",
            output: Array.from(
              { length: 24 },
              (_, i) =>
                `  ${i + 1}  ${i === 0 ? `// ${file}` : `export const step${i} = () => ${i};`}`,
            ).join("\n"),
            isError: false,
            truncated: false,
            durationMs: 42,
          },
        });
        emit(entry, {
          type: "model.response",
          data: {
            messageId: "demo-response",
            model: run.spec.model,
            usage: {
              input: 4820,
              output: 1240,
              cacheRead: 3200,
              cacheWrite: 0,
              costUsd: run.progress.costUsd,
            },
          },
        });
      }
      if (run.state === "awaiting_approval")
        emit(entry, {
          type: "approval.requested",
          data: {
            approvalId: "demo-approval",
            toolCallId: "migration",
            name: "bash",
            risk: "exec",
          },
        });
      if (run.state === "running") {
        for (const message of ["policy bash exec: allow", "policy editor write: allow"]) {
          emit(entry, { type: "log", data: { level: "debug", message } });
        }
        emit(entry, {
          type: "tool.call",
          data: {
            toolCallId: "test-reconnect",
            name: "bash",
            risk: "exec",
            input: { command: "pnpm test -- reconnect" },
          },
        });
      }
      if (run.result?.verify) emit(entry, { type: "verify.result", data: run.result.verify });
      if (run.result) emit(entry, { type: "run.result", data: run.result });
      if (run.state !== "queued" && run.state !== "running")
        emit(entry, { type: "run.state_changed", data: { from: "running", to: run.state } });
      entry.events.forEach((event, index) => {
        const start = Date.parse(run.createdAt);
        const span = Math.max(0, Date.parse(updated) - start);
        event.ts = new Date(
          start + (span * index) / Math.max(1, entry.events.length - 1),
        ).toISOString();
      });
      run.updatedAt = updated;
      globalState.nanogentWebFake.set(run.spec.id, entry);
    }
  }
  const entries = globalState.nanogentWebFake;
  return {
    list: async (owner) =>
      [...entries.values()]
        .filter((e) => e.owner === owner)
        .map((e) => {
          return e.run;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    get: async (owner, id) => {
      const e = entries.get(id);
      if (!e || e.owner !== owner) return undefined;
      return e.run;
    },
    events: async (id, from) => {
      const e = entries.get(id);
      if (e) advance(e, from);
      const events = (e?.events ?? []).filter((event) => event.seq >= from);
      return { events, nextSeq: (events.at(-1)?.seq ?? from - 1) + 1, hasMore: false };
    },
    withOwnerLock: async (_owner, work) => work(),
    allowance: async (owner) => ({
      activeCount: [...entries.values()].filter((e) => e.owner === owner && active(e.run.state))
        .length,
      charged: [...entries.values()]
        .filter(
          (e) =>
            e.owner === owner &&
            (active(e.run.state) ||
              e.run.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)),
        )
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
        scripted: true,
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
