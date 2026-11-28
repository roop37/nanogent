import assert from "node:assert/strict";
import test from "node:test";
import { convert } from "./convert.js";

test("JSON array mode is formatted and preserves values", () => {
  assert.equal(
    convert("name,id\nAda,001\n", "json"),
    '[\n  {\n    "name": "Ada",\n    "id": "001"\n  }\n]\n',
  );
  assert.equal(convert("name,id\n", "json"), "[]\n");
});
