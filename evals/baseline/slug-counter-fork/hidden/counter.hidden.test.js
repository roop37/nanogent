import assert from "node:assert/strict";
import test from "node:test";
import { slugifyWithCounter } from "./index.js";

test("fork copies occupied slugs and counts, including case variants", () => {
  const original = slugifyWithCounter();
  original("docs");
  original("docs");
  const copy = original.fork();
  assert.equal(copy("DOCS", { lowercase: false }), "DOCS-3");
  assert.notEqual(copy("docs 2"), "docs-2");
  assert.equal(original("docs"), "docs-3");
  const descendant = copy.fork();
  copy.reset();
  assert.equal(copy("docs"), "docs");
  assert.notEqual(descendant("docs"), "docs");
  assert.equal(original("docs"), "docs-4");
});
