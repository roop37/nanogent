import assert from "node:assert/strict";
import test from "node:test";
import { createMailer } from "./mailer.js";
import { resetUsers, signUp } from "./signup.js";

test("email is sent before signUp resolves", async () => {
  resetUsers();
  const sent = [];
  const result = await signUp("b@example.com", createMailer(sent));
  assert.equal(result.emailed, true);
  assert.equal(sent.length, 1);
});
test("duplicate signups are rejected without sending", async () => {
  resetUsers();
  const sent = [];
  const mailer = createMailer(sent);
  await signUp("c@example.com", mailer);
  assert.deepEqual(await signUp("c@example.com", mailer), { ok: false, reason: "exists" });
  assert.equal(sent.length, 1);
});
