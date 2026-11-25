import assert from "node:assert/strict";
import test from "node:test";
import { postUser } from "./api.js";

test("rejects bad email", () => {
  assert.equal(postUser({ username: "abc", email: "nope" }).status, 400);
});
