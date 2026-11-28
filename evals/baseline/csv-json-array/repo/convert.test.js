import assert from "node:assert/strict";
import test from "node:test";
import { convert } from "./convert.js";

test("writes JSON Lines and preserves cell strings", () => {
  assert.equal(convert('name,id\n"Van, Al",001\n\n'), '{"name":"Van, Al","id":"001"}\n');
});

test("rejects a row with missing cells", () => {
  assert.throws(() => convert("name,id\nAda"), /Malformed CSV/);
});
