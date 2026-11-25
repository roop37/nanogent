import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "./cache.js";

test("returns fresh values", () => {
  let t = 0;
  const cache = new TtlCache(60, () => t);
  cache.set("a", 1);
  t = 1000;
  assert.equal(cache.get("a"), 1);
});
