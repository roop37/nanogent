import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, RUN_TRANSITIONS, RunStateSchema } from "../src/index.js";

const legal = new Set([
  "queued:running",
  "queued:canceled",
  "running:awaiting_approval",
  "running:completed",
  "running:failed",
  "running:canceled",
  "awaiting_approval:running",
  "awaiting_approval:failed",
  "awaiting_approval:canceled",
]);

describe("run state machine", () => {
  for (const from of RunStateSchema.options) {
    for (const to of RunStateSchema.options) {
      it(`${from} -> ${to}`, () => {
        const allowed = legal.has(`${from}:${to}`);
        expect(canTransition(from, to)).toBe(allowed);
        if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow("Illegal run transition");
      });
    }
  }
  it("cannot mutate terminal transitions", () => {
    expect(Object.isFrozen(RUN_TRANSITIONS)).toBe(true);
    for (const state of ["completed", "failed", "canceled"] as const) {
      expect(RUN_TRANSITIONS[state]).toEqual([]);
      expect(Object.isFrozen(RUN_TRANSITIONS[state])).toBe(true);
    }
  });
});
