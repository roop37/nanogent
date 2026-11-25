import { describe, expect, it } from "vitest";
import { costUsd, MODEL_PRICING } from "../src/index.js";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
describe("pricing", () => {
  it.each([
    ["claude-opus-5-5", [4, 20, 0.2, 5]],
    ["claude-sonnet-5-5", [2, 10, 0.1, 2.5]],
    ["claude-haiku-5-5", [0.1, 0.5, 0.01, 0.125]],
  ] as const)("prices each token category for %s", (model, expected) => {
    expect(costUsd(model, zero)).toBe(0);
    for (const [index, field] of (
      ["input", "output", "cacheRead", "cacheWrite"] as const
    ).entries()) {
      expect(costUsd(model, { ...zero, [field]: 1_000_000 })).toBe(expected[index]);
    }
  });
  it("sums disjoint categories without double counting or early rounding", () => {
    const usage = { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000, costUsd: 999 };
    expect(costUsd("claude-opus-5-5", usage)).toBeCloseTo(0.0646, 10);
    expect(costUsd("claude-haiku-5-5", { ...zero, cacheRead: 1 })).toBe(0.00000001);
  });
  it.each(["unknown", "toString", "__proto__", ""])("rejects unknown model %s", (model) => {
    expect(() => costUsd(model, zero)).toThrow("Unknown model");
  });
  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid token count %s", (input) => {
    expect(() => costUsd("claude-opus-5-5", { ...zero, input })).toThrow();
  });
  it("keeps the price table immutable", () => {
    expect(Object.isFrozen(MODEL_PRICING)).toBe(true);
    expect(Object.values(MODEL_PRICING).every(Object.isFrozen)).toBe(true);
  });
});
