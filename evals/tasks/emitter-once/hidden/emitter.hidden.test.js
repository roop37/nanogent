import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "./emitter.js";

test("once fires exactly once and cleans up", () => {
  const e = new Emitter();
  let calls = 0;
  e.once("x", () => calls++);
  e.emit("x");
  e.emit("x");
  assert.equal(calls, 1);
  assert.equal(e.listenerCount("x"), 0);
});
test("off with the original function removes a once handler before it fires", () => {
  const e = new Emitter();
  let calls = 0;
  const fn = () => calls++;
  e.once("x", fn);
  e.off("x", fn);
  e.emit("x");
  assert.equal(calls, 0);
  assert.equal(e.listenerCount("x"), 0);
});
test("the function returned by once removes it", () => {
  const e = new Emitter();
  let calls = 0;
  const stop = e.once("x", () => calls++);
  stop();
  stop();
  e.emit("x");
  assert.equal(calls, 0);
});
test("a handler removing itself during emit doesn't skip the next handler", () => {
  const e = new Emitter();
  const seen = [];
  const stop = e.on("x", () => {
    seen.push("a");
    stop();
  });
  e.on("x", () => seen.push("b"));
  e.emit("x");
  assert.deepEqual(seen, ["a", "b"]);
});
test("once handlers next to each other all fire", () => {
  const e = new Emitter();
  const seen = [];
  e.once("x", () => seen.push(1));
  e.once("x", () => seen.push(2));
  e.once("x", () => seen.push(3));
  e.emit("x");
  assert.deepEqual(seen, [1, 2, 3]);
});
test("handlers added during emit wait for the next emit", () => {
  const e = new Emitter();
  const seen = [];
  e.once("x", () => e.on("x", () => seen.push("late")));
  e.emit("x");
  assert.deepEqual(seen, []);
  e.emit("x");
  assert.deepEqual(seen, ["late"]);
});
test("the same function registered twice runs twice and off removes one", () => {
  const e = new Emitter();
  let calls = 0;
  const fn = () => calls++;
  e.on("x", fn);
  e.on("x", fn);
  e.emit("x");
  e.off("x", fn);
  e.emit("x");
  assert.equal(calls, 3);
});
