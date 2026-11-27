import "server-only";
import { DEFAULT_MODEL } from "@nanogent/config";
import { DEFAULT_LIMITS, RunSpecSchema, type RunState } from "@nanogent/core";
import type { RunView } from "../types";

const changes: Record<string, string> = {
  "src/cursor.ts": `export interface Cursor {
  timestamp: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  const decoded: unknown = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  );
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid cursor");
  }
  if (!("timestamp" in decoded) || !("id" in decoded)) {
    throw new Error("Incomplete cursor");
  }
  if (typeof decoded.timestamp !== "string" || typeof decoded.id !== "string") {
    throw new Error("Invalid cursor fields");
  }
  return { timestamp: decoded.timestamp, id: decoded.id };
}`,
  "src/activity.ts": `import { decodeCursor, encodeCursor } from "./cursor";
import { database } from "./database";

export async function listActivity(after?: string) {
  const cursor = after ? decodeCursor(after) : undefined;
  const rows = await database.activity.findMany({
    take: 26,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    where: cursor ? {
      OR: [
        { timestamp: { lt: cursor.timestamp } },
        { timestamp: cursor.timestamp, id: { lt: cursor.id } },
      ],
    } : undefined,
  });
  const items = rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next: rows.length > 25 && last
      ? encodeCursor({ timestamp: last.timestamp, id: last.id })
      : null,
  };
}`,
  "test/cursor.test.ts": `import { expect, test } from "vitest";
import { encodeCursor, decodeCursor } from "../src/cursor";

const cursor = {
  timestamp: "2026-11-26T10:00:00.000Z",
  id: "activity-024",
};

test("round trips the timestamp and tie breaker", () => {
  expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
});

test("rejects missing fields", () => {
  const invalid = Buffer.from("{}").toString("base64url");
  expect(() => decodeCursor(invalid)).toThrow("Incomplete cursor");
});

test("rejects non-string ids", () => {
  const invalid = Buffer.from(JSON.stringify({ ...cursor, id: 24 }))
    .toString("base64url");
  expect(() => decodeCursor(invalid)).toThrow("Invalid cursor fields");
});`,
};
export const demoDiff = Object.entries(changes)
  .map(
    ([file, content]) =>
      `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${content.split("\n").length} @@\n${content
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n")}\n`,
  )
  .join("");
const reconnectDiff = `diff --git a/src/events.ts b/src/events.ts
--- a/src/events.ts
+++ b/src/events.ts
@@ -1,4 +1,4 @@
 export function subscribe(url: string) {
-  const stream = new EventSource(url);
+  const stream = new EventSource(url, { withCredentials: true });
   return () => stream.close();
 }
`;
export function demoRuns(now = Date.now()): RunView[] {
  const tasks: [RunState, string, string, number][] = [
    ["running", "Handle reconnects in the event stream", "acme/console", 0.0182],
    ["queued", "Add keyboard navigation to the file tree", "acme/console", 0],
    ["awaiting_approval", "Update the database migration for teams", "acme/platform", 0.0064],
    ["completed", "Fix cursor pagination on the activity feed", "acme/platform", 0.0412],
    ["completed", "Cache repository metadata between requests", "acme/cli", 0.0238],
    ["completed", "Preserve line endings when applying a patch", "acme/cli", 0.0126],
    ["failed", "Fix timezone handling in scheduled reports", "acme/platform", 0.0351],
    ["canceled", "Replace the legacy config parser", "acme/cli", 0.0093],
  ];
  return tasks.map(([state, task, repo, cost], index) => {
    const elapsed = [92, 30, 880, 124, 1500, 48, 340, 65][index] ?? 60;
    const created =
      now -
      (index < 5 ? (index < 3 ? elapsed * 1000 : (index + 1) * 720000) : (index - 3) * 86400000);
    const spec = RunSpecSchema.parse({
      id: `run_000000demo_${String(index + 1).padStart(24, "0")}`,
      repo: { url: `https://github.com/${repo}` },
      task,
      model: DEFAULT_MODEL,
      effort: "medium",
      verifyCommand: "pnpm test",
      setupCommands: ["pnpm install --frozen-lockfile"],
      limits: { ...DEFAULT_LIMITS, maxCostUsd: 0.1 },
    });
    const terminal = state === "completed" || state === "failed" || state === "canceled";
    return {
      spec,
      state,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(terminal ? created + elapsed * 1000 : now).toISOString(),
      cancelRequested: state === "canceled",
      ...(state === "running" ? { diffSnapshot: reconnectDiff } : {}),
      progress: {
        turns: state === "queued" ? 0 : 4,
        toolCalls: state === "queued" ? 0 : 9,
        costUsd: cost,
      },
      ...(terminal
        ? {
            result: {
              status: state,
              summary:
                state === "completed"
                  ? "Implemented the change and added regression coverage. All checks pass."
                  : state === "failed"
                    ? "The change still fails the daylight-saving boundary test."
                    : "Stopped before verification.",
              diff:
                state !== "completed"
                  ? ""
                  : index === 3
                    ? demoDiff
                    : index === 4
                      ? "diff --git a/src/repository.ts b/src/repository.ts\n--- a/src/repository.ts\n+++ b/src/repository.ts\n@@ -1 +1,3 @@\n-export const metadata = (repo) => fetchMetadata(repo);\n+export async function metadata(repo) {\n+  return cache.getOrSet(repo, () => fetchMetadata(repo), 60_000);\n+}\n"
                      : 'diff --git a/src/patch.ts b/src/patch.ts\n--- a/src/patch.ts\n+++ b/src/patch.ts\n@@ -1 +1,2 @@\n-return lines.join("\\n");\n+const eol = original.includes("\\r\\n") ? "\\r\\n" : "\\n";\n+return lines.join(eol);\n',
              verify:
                state === "canceled"
                  ? null
                  : {
                      command: "pnpm test",
                      durationMs: 1240,
                      exitCode: state === "completed" ? 0 : 1,
                      output:
                        state === "completed"
                          ? "Test Files  3 passed (3)\nTests  12 passed (12)\nDuration  1.24s"
                          : "FAIL report.test.ts > daylight-saving boundary\nExpected 09:00, received 10:00\nTests  1 failed | 11 passed",
                    },
              verified: state === "completed",
              usage: { input: 4820, output: 1240, cacheRead: 3200, cacheWrite: 0, costUsd: cost },
              turns: 4,
              toolCalls: 9,
              durationMs: elapsed * 1000,
              ...(state === "failed" ? { failureReason: "Verification failed (exit 1)." } : {}),
            },
          }
        : {}),
    };
  });
}
