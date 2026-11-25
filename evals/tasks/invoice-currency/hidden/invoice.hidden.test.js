import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoice } from "./invoice.js";
import { formatPrice } from "./money.js";

test("formatPrice supports USD, EUR and INR", () => {
  assert.equal(formatPrice(1234, "USD"), "$12.34");
  assert.equal(formatPrice(1234, "EUR"), "€12.34");
  assert.equal(formatPrice(1234, "INR"), "₹12.34");
  assert.equal(formatPrice(5), "$0.05");
});
test("unknown currency throws", () => {
  assert.throws(() => formatPrice(100, "XYZ"), /currency/i);
});
test("invoice uses its currency, USD by default", () => {
  const items = [
    { name: "Chai", cents: 2000 },
    { name: "Samosa", cents: 1500 },
  ];
  assert.equal(
    renderInvoice({ currency: "INR", items }),
    "Chai: ₹20.00\nSamosa: ₹15.00\nTotal: ₹35.00",
  );
  assert.equal(renderInvoice({ items: [{ name: "Tea", cents: 350 }] }), "Tea: $3.50\nTotal: $3.50");
});
