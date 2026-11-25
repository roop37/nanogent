import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "./csv.js";

test("plain rows", () => {
  assert.deepEqual(parse("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});
