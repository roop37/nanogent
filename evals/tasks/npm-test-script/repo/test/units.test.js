import assert from "node:assert/strict";
import test from "node:test";
import { celsiusToFahrenheit } from "../units.js";

test("freezing point", () => {
  assert.equal(celsiusToFahrenheit(0), 32);
});
