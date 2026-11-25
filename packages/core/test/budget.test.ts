import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, type Limits, type Usage } from "../src/index.js";

const zeroUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

describe("Budget", () => {
  it("starts empty and accumulates usage", () => {
    const budget = new Budget(undefined, () => 100);
    expect(budget.check()).toEqual({ ok: true });
    budget.recordTurn();
    budget.recordToolCall();
    budget.recordUsage({ input: 10, output: 5, cacheRead: 2, cacheWrite: 3, costUsd: 0.1 });
    budget.recordUsage({ input: 20, output: 7, cacheRead: 4, cacheWrite: 6, costUsd: 0.2 });
    const snapshot = budget.snapshot();
    expect(snapshot).toMatchObject({
      turns: 1,
      toolCalls: 1,
      elapsedMs: 0,
      usage: { input: 30, output: 12, cacheRead: 6, cacheWrite: 9 },
    });
    expect(snapshot.usage.costUsd).toBeCloseTo(0.3);
  });
  it.each(["maxTurns", "maxToolCalls"] as const)("stops at and beyond %s", (limit) => {
    const budget = new Budget({ ...DEFAULT_LIMITS, [limit]: 2 });
    const record = () => (limit === "maxTurns" ? budget.recordTurn() : budget.recordToolCall());
    record();
    expect(budget.check()).toEqual({ ok: true });
    record();
    expect(budget.check()).toEqual({ ok: false, reason: limit });
    record();
    expect(budget.check()).toEqual({ ok: false, reason: limit });
  });
  it.each([
    ["maxCostUsd", "costUsd"],
    ["maxInputTokens", "input"],
    ["maxInputTokens", "cacheRead"],
    ["maxInputTokens", "cacheWrite"],
    ["maxOutputTokens", "output"],
  ] as const)("checks %s using %s", (limit, field) => {
    const budget = new Budget({ ...DEFAULT_LIMITS, [limit]: 10 });
    budget.recordUsage({ ...zeroUsage, [field]: 9 });
    expect(budget.check()).toEqual({ ok: true });
    budget.recordUsage({ ...zeroUsage, [field]: 1 });
    expect(budget.check()).toEqual({ ok: false, reason: limit });
    budget.recordUsage({ ...zeroUsage, [field]: 1 });
    expect(budget.check()).toEqual({ ok: false, reason: limit });
  });
  it("counts all input token buckets together", () => {
    const budget = new Budget({ ...DEFAULT_LIMITS, maxInputTokens: 10 });
    budget.recordUsage({ ...zeroUsage, input: 4, cacheRead: 3, cacheWrite: 3 });
    expect(budget.check()).toEqual({ ok: false, reason: "maxInputTokens" });
  });
  it("uses injected milliseconds, including time waiting for approval", () => {
    let time = 1_000;
    const budget = new Budget({ ...DEFAULT_LIMITS, maxWallClockSec: 2 }, () => time);
    time = 2_999;
    expect(budget.check()).toEqual({ ok: true });
    time = 3_000;
    expect(budget.check()).toEqual({ ok: false, reason: "maxWallClockSec" });
    time = 4_000;
    expect(budget.check()).toEqual({ ok: false, reason: "maxWallClockSec" });
    time = 500;
    expect(budget.snapshot().elapsedMs).toBe(3_000);
  });
  it("checks per-command time and output byte ceilings", () => {
    const budget = new Budget({ ...DEFAULT_LIMITS, commandTimeoutSec: 1, maxToolOutputBytes: 4 });
    expect(budget.check({ commandDurationMs: 1000, toolOutputBytes: 4 })).toEqual({ ok: true });
    expect(budget.check({ commandDurationMs: 1001 })).toEqual({
      ok: false,
      reason: "commandTimeoutSec",
    });
    expect(budget.check({ toolOutputBytes: Buffer.byteLength("界界") })).toEqual({
      ok: false,
      reason: "maxToolOutputBytes",
    });
    expect(budget.check()).toEqual({ ok: true }); // Observations do not accumulate between commands.
  });
  it("protects limits and snapshots from caller mutation", () => {
    const limits: Limits = { ...DEFAULT_LIMITS };
    const budget = new Budget(limits);
    limits.maxTurns = 1;
    budget.snapshot().usage.input = 999;
    expect(budget.limits.maxTurns).toBe(60);
    expect(Object.isFrozen(budget.limits)).toBe(true);
    expect(budget.snapshot().usage.input).toBe(0);
  });
  it("rejects invalid and overflowing accounting without changing totals", () => {
    const budget = new Budget();
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      expect(() => budget.recordUsage({ ...zeroUsage, input: value })).toThrow();
    }
    expect(() => budget.recordUsage({ ...zeroUsage, costUsd: -0.1 })).toThrow();
    expect(budget.snapshot().usage).toEqual(zeroUsage);
    budget.recordUsage({ ...zeroUsage, input: Number.MAX_SAFE_INTEGER });
    expect(() => budget.recordUsage({ ...zeroUsage, input: 1 })).toThrow();
    expect(budget.snapshot().usage.input).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => budget.check({ toolOutputBytes: -1 })).toThrow();
    expect(() => budget.check({ commandDurationMs: Number.NaN })).toThrow();
    expect(() => new Budget({ ...DEFAULT_LIMITS, maxTurns: 0 })).toThrow();
    expect(() => new Budget(DEFAULT_LIMITS, () => Number.NaN)).toThrow();
  });
});
