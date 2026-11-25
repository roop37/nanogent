import assert from "node:assert/strict";
import test from "node:test";
import { nights } from "./dates.js";

test("nights", () => {
  assert.equal(nights("2026-03-01", "2026-03-04"), 3);
});
