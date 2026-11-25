import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "./emitter.js";

test("on and emit", () => {
  const e = new Emitter();
  const seen = [];
  e.on("x", (v) => seen.push(v));
  e.emit("x", 1);
  e.emit("x", 2);
  assert.deepEqual(seen, [1, 2]);
});
