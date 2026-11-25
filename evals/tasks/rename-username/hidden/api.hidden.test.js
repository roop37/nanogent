import assert from "node:assert/strict";
import test from "node:test";
import { postUser } from "./api.js";

test("accepts and returns username", () => {
  const res = postUser({ username: "roop", email: "r@example.com" });
  assert.equal(res.status, 201);
  assert.equal(res.body.username, "roop");
  assert.equal("userName" in res.body, false);
});
test("validation message uses username", () => {
  const res = postUser({ username: "ab", email: "r@example.com" });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.errors, ["username must be at least 3 characters"]);
});
test("old field name is no longer accepted", () => {
  assert.equal(postUser({ userName: "roop", email: "r@example.com" }).status, 400);
});
