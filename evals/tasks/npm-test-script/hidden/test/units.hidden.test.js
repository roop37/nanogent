import assert from "node:assert/strict";
import test from "node:test";
import { celsiusToFahrenheit, kmToMiles } from "../units.js";

test("boiling point", () => {
  assert.equal(celsiusToFahrenheit(100), 212);
});
test("marathon", () => {
  assert.ok(Math.abs(kmToMiles(42.195) - 26.2188) < 0.001);
});
