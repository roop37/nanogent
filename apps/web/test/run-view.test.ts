import { readFileSync } from "node:fs";
import type { RunEvent } from "@nanogent/core";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../lib/ansi";
import { composite, contrast, luminance } from "../lib/contrast";
import { buildFileTree, changedRange, parseDiff, splitRows } from "../lib/diff";
import { demoRuns } from "../lib/server/demo-runs";
import { costLevel, groupTimeline, mergeEvents } from "../lib/timeline";
import { commandDuration, duration, formatDuration, modelName } from "../lib/types";

const patch = (body: string, path = "src/a.ts") => `diff --git a/${path} b/${path}\n${body}`;
describe("unified patch parsing", () => {
  it("reads additions, deletions and context with separate counters", () => {
    const [file] = parseDiff(
      patch("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2,2 +2,3 @@ fn\n before\n-old\n+new\n+extra\n"),
    );
    expect(file).toMatchObject({ path: "src/a.ts", status: "M", added: 2, deleted: 1 });
    expect(file?.hunks[0]?.lines).toMatchObject([
      { kind: "context", old: 2, new: 2 },
      { kind: "delete", old: 3 },
      { kind: "add", new: 3 },
      { kind: "add", new: 4 },
    ]);
    expect(file?.patch.endsWith("\n")).toBe(true);
  });
  it("handles new and deleted files, zero counts and no trailing newline", () => {
    const files = parseDiff(
      patch("new file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+new\n") +
        patch(
          "deleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old",
          "old.ts",
        ),
    );
    expect(files.map((f) => [f.path, f.status, f.added, f.deleted])).toEqual([
      ["src/a.ts", "A", 1, 0],
      ["old.ts", "D", 0, 1],
    ]);
    expect(files[1]?.patch.endsWith("\n")).toBe(false);
  });
  it("preserves real a/ and b/ directories in rename metadata", () => {
    expect(parseDiff(patch("rename from a/old.ts\nrename to b/new.ts\n"))[0]).toMatchObject({
      oldPath: "a/old.ts",
      path: "b/new.ts",
    });
  });
  it("handles rename-only and binary markers", () => {
    expect(
      parseDiff(patch("similarity index 100%\nrename from old.ts\nrename to new.ts\n"))[0],
    ).toMatchObject({ path: "new.ts", oldPath: "old.ts", status: "R", hunks: [] });
    for (const marker of ["Binary files a/a.png and b/a.png differ", "GIT binary patch"])
      expect(parseDiff(patch(marker, "a.png"))[0]?.binary).toBe(true);
  });
  it("retains no-newline markers and resets counters between hunks", () => {
    const file = parseDiff(
      patch(
        "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n@@ -20,2 +21,2 @@\n same\n-old\n+new\n",
      ),
    )[0];
    expect(file?.hunks).toHaveLength(2);
    expect(file?.hunks[0]?.lines.filter((l) => l.kind === "marker")).toHaveLength(2);
    expect(file?.hunks[1]?.lines[0]).toMatchObject({ old: 20, new: 21 });
  });
  it("parses CRLF while preserving the exact downloadable patch", () => {
    const raw = patch(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n--- content\n+++ content\n",
    ).replaceAll("\n", "\r\n");
    const file = parseDiff(raw)[0];
    expect(file?.patch).toBe(raw);
    expect(file?.hunks[0]?.lines.map((l) => l.text)).toEqual(["-- content", "++ content"]);
  });
  it("reads quoted paths and keeps markup as text", () => {
    const file = parseDiff(
      'diff --git "a/a b.ts" "b/a b.ts"\n--- "a/a b.ts"\n+++ "b/a b.ts"\n@@ -0,0 +1 @@\n+<script>alert(1)</script>\n',
    )[0];
    expect(file?.path).toBe("a b.ts");
    expect(file?.hunks[0]?.lines[0]?.text).toBe("<script>alert(1)</script>");
    expect(parseDiff("nonsense")).toEqual([]);
  });
  it("decodes Git's octal-escaped UTF-8 filenames", () => {
    const file = parseDiff('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n')[0];
    expect(file?.path).toBe("café.txt");
  });
  it("reads consecutive unified file patches without Git metadata", () => {
    const remove = "--- old.txt\t2025-01-01\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
    const add = "--- /dev/null\n+++ new.txt\t2025-01-02\n@@ -0,0 +1 @@\n+new\n";
    expect(parseDiff(remove + add)).toMatchObject([
      { path: "old.txt", deleted: 1, status: "D", patch: remove },
      { path: "new.txt", added: 1, status: "A", patch: add },
    ]);
  });
  it("aligns unequal replacements without losing line identities", () => {
    const lines =
      parseDiff(patch("@@ -1,2 +1,3 @@\n before\n-old\n+new\n+extra\n"))[0]?.hunks[0]?.lines ?? [];
    const rows = splitRows(lines);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.left).toBe(rows[0]?.right);
    expect(rows[1]?.left?.kind).toBe("delete");
    expect(rows[1]?.right?.kind).toBe("add");
    expect(rows[2]?.left).toBeUndefined();
  });
  it("highlights changed words and handles insertions and identical text", () => {
    expect(changedRange("const foo = 1;", "const bar = 1;")).toEqual([6, 9]);
    expect(changedRange("same", "same")).toEqual([4, 4]);
    expect(changedRange("one two", "one")).toEqual([3, 7]);
  });
  it("builds nested folders without treating path segments as object keys", () => {
    const files = ["src/a.ts", "src/nested/b.ts", "__proto__/x", "README.md"]
      .map((p) => parseDiff(patch("", p))[0])
      .filter((f) => !!f);
    const tree = buildFileTree(files);
    expect(tree.map((n) => n.name)).toEqual(["src", "__proto__", "README.md"]);
    expect(tree[0]?.children[1]?.children[0]).toMatchObject({
      name: "b.ts",
      file: 1,
      path: "src/nested/b.ts",
    });
  });
});
describe("terminal escapes", () => {
  it("renders plain text and SGR foreground, bold and resets", () => {
    const spans = parseAnsi("plain \x1b[31;1mred\x1b[22;39m normal");
    expect(spans.map((s) => s.text).join("")).toBe("plain red normal");
    expect(spans[1]).toMatchObject({ color: "#f88078", bold: true });
    expect(spans[2]?.color).toBeUndefined();
    expect(spans[2]?.bold).toBe(false);
    expect(parseAnsi("\x1b[94mblue\x1b[0mend")[0]?.color).toBe("#a1cfff");
  });
  it("supports RGB and indexed colors and discards terminal actions and links", () => {
    expect(parseAnsi("\x1b[38;2;100;150;200mhi")[0]?.color).toBe("rgb(100,150,200)");
    expect(parseAnsi("\x1b[38;5;196mhi")[0]?.color).toBe("rgb(255,0,0)");
    expect(
      parseAnsi("\x1b[2J<script>\x1b]8;;https://bad.test\x07link\x1b]8;;\x07")
        .map((s) => s.text)
        .join(""),
    ).toBe("<script>link");
    expect(parseAnsi("\x1b[48;2;1;31;1mx")[0]?.color).toBeUndefined();
    expect(parseAnsi("")).toEqual([]);
  });
});
function event(seq: number, value: Pick<RunEvent, "type" | "data">): RunEvent {
  return {
    ...value,
    seq,
    runId: "run_000000demo_000000000000000000000001",
    ts: "2026-11-26T12:00:00Z",
  } as RunEvent;
}
describe("timeline grouping", () => {
  const call = event(1, {
    type: "tool.call",
    data: { toolCallId: "a", name: "bash", input: { command: "pwd" }, risk: "exec" },
  });
  const result = event(3, {
    type: "tool.result",
    data: { toolCallId: "a", output: "/repo", isError: false, truncated: false, durationMs: 5 },
  });
  const log = event(2, { type: "log", data: { level: "info", message: "policy allowed" } });
  it("pairs results with calls across intervening events without duplicate keys", () => {
    const steps = groupTimeline([call, log, result, call, result]);
    expect(steps.map((s) => s.seq)).toEqual([1, 2]);
    expect(steps[0]?.result).toEqual(result);
    expect(groupTimeline([result])[0]?.event).toBe(result);
  });
  it("merges replays and duplicates inside pages, preserving the recorded event", () => {
    const merged = mergeEvents([call], [result, call, log, log]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(merged[0]).toBe(call);
  });
  it("groups contiguous logs and counts model turns and cumulative costs", () => {
    const model = {
      type: "model.response" as const,
      data: {
        messageId: "m",
        model: "test",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
      },
    };
    const steps = groupTimeline([log, event(3, log), event(4, model), event(5, model)]);
    expect(steps[0]?.logs).toHaveLength(2);
    expect(steps[2]).toMatchObject({ turn: 2, cumulative: 0.02 });
  });
});
describe("run metrics", () => {
  it.each([
    [0, "normal"],
    [0.799, "normal"],
    [0.8, "warning"],
    [0.999, "warning"],
    [1, "danger"],
    [2, "danger"],
  ])("cost %s has tone %s", (cost, tone) => {
    expect(costLevel(Number(cost), 1).tone).toBe(tone);
  });
  it("caps progress and handles zero limits", () => {
    expect(costLevel(2, 1).percent).toBe(100);
    expect(costLevel(0, 0).percent).toBe(0);
    expect(costLevel(1, 0).tone).toBe("danger");
  });
  it("marks eighty cents per dollar and eight cents per dime as amber", () => {
    expect(costLevel(0.8, 1).tone).toBe("warning");
    expect(costLevel(0.08, 0.1).tone).toBe("warning");
  });
  it.each([
    [30000, "30s"],
    [722000, "12m 02s"],
    [3840000, "1h 04m"],
    [-1, "0s"],
  ])("formats %s", (ms, text) => expect(formatDuration(Number(ms))).toBe(text));
  it("leaves queued runs blank and uses the live clock for active runs", () => {
    const runs = demoRuns(10000000);
    const running = runs[0];
    const queued = runs[1];
    if (!running || !queued) throw new Error("Missing demo runs");
    expect(duration(queued)).toBe("—");
    expect(duration(running, 10001000)).toBe("1m 33s");
    expect(modelName("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
  });
  it("keeps sub-second verification and tool timings readable", () => {
    expect(commandDuration(42)).toBe("42ms");
    expect(commandDuration(1240)).toBe("1.24s");
    expect(commandDuration(10000)).toBe("10s");
  });
});
describe("token contrast", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const tokens = Object.fromEntries(
    [...css.matchAll(/--([\w-]+): (#[\da-f]{6}(?:[\da-f]{2})?);/g)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
  const token = (name: string) => {
    const value = tokens[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  it("matches WCAG reference values", () => {
    expect(contrast("#ffffff", "#000000")).toBe(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.478, 2);
    expect(luminance("#000000")).toBe(0);
    expect(() => luminance("invalid")).toThrow();
  });
  for (const text of [
    "foreground",
    "muted",
    "faint",
    "link",
    "running",
    "success",
    "error",
    "warning",
    "neutral",
  ])
    for (const background of ["background", "panel", "hover", "input-background", "selected"])
      it(`${text} on ${background} passes 4.5:1`, () => {
        expect(contrast(token(text), token(background))).toBeGreaterThanOrEqual(4.5);
      });
  it("checks selection, diff backgrounds, buttons and control boundaries", () => {
    expect(contrast(token("foreground"), token("selection"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("on-accent"), token("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("panel"), token("error"))).toBeGreaterThanOrEqual(4.5);
    for (const opacity of [0.8, 0.9]) {
      expect(
        contrast(token("on-accent"), composite(token("accent"), token("background"), opacity)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(token("panel"), composite(token("error"), token("background"), opacity)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ["background", "panel", "hover", "input-background", "selected"]) {
      expect(contrast(token("input-border"), token(background))).toBeGreaterThanOrEqual(3);
      expect(contrast(token("focus"), token(background))).toBeGreaterThanOrEqual(3);
    }
    const blend = (overlay: string, background: string) => {
      const color = token(overlay);
      return composite(color.slice(0, 7), background, Number.parseInt(color.slice(7), 16) / 255);
    };
    for (const overlay of ["added", "removed"]) {
      const tint = blend(overlay, token("background"));
      for (const surface of [tint, blend("word-highlight", tint)])
        for (const text of ["foreground", "muted"])
          expect(contrast(token(text), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
