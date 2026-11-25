import assert from "node:assert/strict";
import test from "node:test";
import { listItems } from "./api.js";
import { fetchAll } from "./client.js";
import { createStore } from "./store.js";

function seeded(n) {
  const store = createStore();
  for (let i = 1; i <= n; i++) store.add(`item ${i}`);
  return store;
}

test("pages with an opaque cursor", () => {
  const store = seeded(25);
  const first = listItems(store, { limit: 10 });
  assert.deepEqual(
    first.items.map((i) => i.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(typeof first.nextCursor, "string");
  assert.equal("nextOffset" in first, false);
  const second = listItems(store, { limit: 10, cursor: first.nextCursor });
  assert.equal(second.items[0].id, 11);
  const third = listItems(store, { limit: 10, cursor: second.nextCursor });
  assert.deepEqual(
    third.items.map((i) => i.id),
    [21, 22, 23, 24, 25],
  );
  assert.equal(third.nextCursor, null);
});

test("deleting an item that was already returned does not skip the next one", () => {
  const store = seeded(6);
  const first = listItems(store, { limit: 3 });
  store.remove(2);
  const second = listItems(store, { limit: 3, cursor: first.nextCursor });
  assert.deepEqual(
    second.items.map((i) => i.id),
    [4, 5, 6],
  );
});

test("items added while paging show up once, at the end", () => {
  const store = seeded(4);
  const first = listItems(store, { limit: 2 });
  store.add("late");
  const rest = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = listItems(store, { limit: 2, cursor });
    rest.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(rest, [3, 4, 5]);
});

test("exact multiple of the page size ends with a null cursor, not an empty page", () => {
  const store = seeded(4);
  const first = listItems(store, { limit: 2 });
  const second = listItems(store, { limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
});

test("limit defaults to 20 and is capped at 100", () => {
  const store = seeded(150);
  assert.equal(listItems(store).items.length, 20);
  assert.equal(listItems(store, { limit: 500 }).items.length, 100);
});

test("a bad cursor is rejected", () => {
  const store = seeded(3);
  assert.throws(() => listItems(store, { cursor: "not-a-cursor" }), /cursor/i);
});

test("fetchAll uses cursors", () => {
  const store = seeded(7);
  assert.deepEqual(
    fetchAll(store, 3).map((i) => i.id),
    [1, 2, 3, 4, 5, 6, 7],
  );
});
