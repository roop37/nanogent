import assert from "node:assert/strict";
import test from "node:test";
import { total } from "./cart.js";

test("no tax, no discount", () => {
  assert.equal(total([{ priceCents: 250, qty: 2 }]), 500);
});
