import assert from "node:assert/strict";
import test from "node:test";
import { parseAmount } from "./index.js";

test("accepts nonnegative amounts", () => {
  assert.equal(parseAmount("12.50"), 12.5);
  assert.equal(parseAmount("0"), 0);
});
test("rejects negative and nonfinite amounts", () => {
  for (const input of ["-1", "oops", "Infinity"]) {
    assert.throws(() => parseAmount(input), /Invalid amount/);
  }
});
