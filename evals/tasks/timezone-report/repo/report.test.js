import assert from "node:assert/strict";
import test from "node:test";
import { dailyTotals } from "./report.js";

test("UTC totals", () => {
  const orders = [
    { at: "2026-03-01T10:00:00Z", cents: 500 },
    { at: "2026-03-01T12:00:00Z", cents: 250 },
    { at: "2026-03-02T09:00:00Z", cents: 100 },
  ];
  assert.deepEqual(dailyTotals(orders), [
    { day: "2026-03-01", cents: 750 },
    { day: "2026-03-02", cents: 100 },
  ]);
});
