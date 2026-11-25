import assert from "node:assert/strict";
import test from "node:test";
import { subscribe } from "./newsletter.js";
import { canSignUp } from "./signup.js";

test("accepts a normal address", () => {
  assert.equal(canSignUp({ email: "a.b@c.io" }), true);
  assert.equal(subscribe([], "a.b@c.io"), true);
});
