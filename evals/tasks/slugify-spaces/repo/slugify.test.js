import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./slugify.js";

test("simple title", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});
