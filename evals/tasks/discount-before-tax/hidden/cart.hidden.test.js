import assert from "node:assert/strict";
import test from "node:test";
import { total } from "./cart.js";

test("discount is applied before tax, rounded to the cent", () => {
  assert.equal(total([{ priceCents: 1000, qty: 1 }], { taxRate: 0.1, discountPercent: 10 }), 990);
  assert.equal(total([{ priceCents: 999, qty: 3 }], { taxRate: 0.075, discountPercent: 15 }), 2738);
});
test("tax only", () => {
  assert.equal(total([{ priceCents: 1999, qty: 1 }], { taxRate: 0.2 }), 2399);
});
