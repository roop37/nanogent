import assert from "node:assert/strict";
import test from "node:test";
import { fetchAll } from "./client.js";
import { createStore } from "./store.js";

test("fetchAll returns everything", () => {
  const store = createStore();
  for (let i = 0; i < 5; i++) store.add(`item ${i}`);
  assert.equal(fetchAll(store, 2).length, 5);
});
