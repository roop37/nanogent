import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./slugify.js";

test("collapses repeated spaces and punctuation", () => {
  assert.equal(slugify("Hello,   World!"), "hello-world");
  assert.equal(slugify("  Leading and trailing  "), "leading-and-trailing");
  assert.equal(slugify("a - b"), "a-b");
});
test("keeps digits", () => {
  assert.equal(slugify("Top 10 Tips"), "top-10-tips");
});
