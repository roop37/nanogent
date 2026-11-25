import assert from "node:assert/strict";
import test from "node:test";
import { daysTouched, nights } from "./dates.js";

test("daysTouched counts both ends", () => {
  assert.equal(daysTouched("2026-03-01", "2026-03-04"), 4);
  assert.equal(daysTouched("2026-03-01", "2026-03-01"), 1);
  assert.equal(daysTouched("2026-02-27", "2026-03-02"), 4);
});
test("nights unchanged", () => {
  assert.equal(nights("2026-03-01", "2026-03-04"), 3);
  assert.equal(nights("2026-03-01", "2026-03-01"), 0);
});
