import assert from "node:assert/strict";
import test from "node:test";
import { isEmail } from "./email.js";
import { subscribe } from "./newsletter.js";
import { canSignUp } from "./signup.js";

const good = ["a.b@c.io", "x+tag@example.co.in", " padded@example.com "];
const bad = ["a@b", "@example.com", "a@@b.com", "a b@c.io", "abc", "a@b."];

test("isEmail", () => {
  for (const value of good) assert.equal(isEmail(value), true, value);
  for (const value of bad) assert.equal(isEmail(value), false, value);
});
test("both forms agree with isEmail", () => {
  for (const value of [...good, ...bad]) {
    assert.equal(canSignUp({ email: value }), isEmail(value), `signup ${value}`);
    assert.equal(subscribe([], value), isEmail(value), `newsletter ${value}`);
  }
});
test("newsletter stores trimmed lowercase address", () => {
  const list = [];
  subscribe(list, " Padded@Example.com ");
  assert.deepEqual(list, ["padded@example.com"]);
});
