import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "./cache.js";

test("entry is valid until exactly ttl seconds have passed", () => {
  let t = 0;
  const cache = new TtlCache(60, () => t);
  cache.set("a", 1);
  t = 59_999;
  assert.equal(cache.get("a"), 1);
  t = 60_000;
  assert.equal(cache.get("a"), undefined);
});
test("expired entries are removed", () => {
  let t = 0;
  const cache = new TtlCache(1, () => t);
  cache.set("a", 1);
  t = 5_000;
  cache.get("a");
  assert.equal(cache.entries.size, 0);
});
