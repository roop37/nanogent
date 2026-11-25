import assert from "node:assert/strict";
import test from "node:test";
import { createMailer } from "./mailer.js";
import { resetUsers, signUp } from "./signup.js";

test("sends a welcome email", async () => {
  resetUsers();
  const sent = [];
  const result = await signUp("a@example.com", createMailer(sent));
  assert.deepEqual(result, { ok: true, emailed: true });
  assert.deepEqual(sent, [{ to: "a@example.com", subject: "Welcome!" }]);
});
