import assert from "node:assert/strict";
import test from "node:test";
import slugify, { slugifyWithCounter } from "./index.js";

test("keeps plain slugification and a unique counter", () => {
  assert.equal(slugify("Déjà vu"), "deja-vu");
  const counter = slugifyWithCounter();
  assert.equal(counter("Example"), "example");
  assert.equal(counter("Example"), "example-2");
  assert.notEqual(counter("Example 2"), "example-2");
  counter.reset();
  assert.equal(counter("Example"), "example");
});
