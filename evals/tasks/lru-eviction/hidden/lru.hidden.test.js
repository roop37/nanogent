import assert from "node:assert/strict";
import test from "node:test";
import { LruCache } from "./lru.js";

test("never holds more than capacity", () => {
  const cache = new LruCache(2);
  cache.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.has("a"), false);
});
test("get marks an entry as recently used", () => {
  const cache = new LruCache(2);
  cache.set("a", 1).set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.deepEqual(cache.keys().sort(), ["a", "c"]);
});
test("updating an existing key does not evict and refreshes it", () => {
  const cache = new LruCache(2);
  cache.set("a", 1).set("b", 2);
  cache.set("a", 10);
  assert.equal(cache.size, 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), 10);
  assert.equal(cache.has("b"), false);
});
test("has and get on a missing key don't change order", () => {
  const cache = new LruCache(2);
  cache.set("a", 1).set("b", 2);
  assert.equal(cache.get("zzz"), undefined);
  assert.equal(cache.has("a"), true);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false);
});
test("keys are listed from least to most recently used", () => {
  const cache = new LruCache(3);
  cache.set("a", 1).set("b", 2).set("c", 3);
  cache.get("a");
  assert.deepEqual(cache.keys(), ["b", "c", "a"]);
});
test("capacity of one", () => {
  const cache = new LruCache(1);
  cache.set("a", 1).set("b", 2);
  assert.deepEqual(cache.keys(), ["b"]);
});
test("stores falsy values", () => {
  const cache = new LruCache(2);
  cache.set("zero", 0).set("empty", "");
  assert.equal(cache.get("zero"), 0);
  assert.equal(cache.get("empty"), "");
  assert.equal(cache.size, 2);
});
