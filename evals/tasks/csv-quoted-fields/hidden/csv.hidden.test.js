import assert from "node:assert/strict";
import test from "node:test";
import { parse, parseLine } from "./csv.js";

test("commas inside quotes", () => {
  assert.deepEqual(parseLine('1,"Smith, John",NY'), ["1", "Smith, John", "NY"]);
});
test("escaped quotes", () => {
  assert.deepEqual(parseLine('"say ""hi""",x'), ['say "hi"', "x"]);
});
test("empty fields", () => {
  assert.deepEqual(parseLine("a,,c"), ["a", "", "c"]);
  assert.deepEqual(parseLine('"",b'), ["", "b"]);
});
test("whole document", () => {
  assert.deepEqual(parse('name,city\n"Doe, Jane",Pune\n'), [
    ["name", "city"],
    ["Doe, Jane", "Pune"],
  ]);
});
