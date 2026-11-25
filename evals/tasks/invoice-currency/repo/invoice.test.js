import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoice } from "./invoice.js";

test("renders USD", () => {
  assert.equal(renderInvoice({ items: [{ name: "Tea", cents: 350 }] }), "Tea: $3.50\nTotal: $3.50");
});
