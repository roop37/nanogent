import assert from "node:assert/strict";
import test from "node:test";
import { dailyTotals, ordersOn } from "./report.js";

const orders = [
  { at: "2026-03-01T18:29:00Z", cents: 100 }, // 23:59 in India, 13:29 in New York
  { at: "2026-03-01T18:30:00Z", cents: 200 }, // 00:00 next day in India
  { at: "2026-03-02T03:00:00Z", cents: 400 }, // 22:00 previous day in New York
  { at: "2026-03-02T05:00:00Z", cents: 800 }, // 00:00 in New York
];

test("India (+330)", () => {
  assert.deepEqual(dailyTotals(orders, 330), [
    { day: "2026-03-01", cents: 100 },
    { day: "2026-03-02", cents: 1400 },
  ]);
});
test("New York in winter (-300)", () => {
  assert.deepEqual(dailyTotals(orders, -300), [
    { day: "2026-03-01", cents: 700 },
    { day: "2026-03-02", cents: 800 },
  ]);
});
test("UTC by default", () => {
  assert.deepEqual(dailyTotals(orders), [
    { day: "2026-03-01", cents: 300 },
    { day: "2026-03-02", cents: 1200 },
  ]);
});
test("ordersOn agrees with dailyTotals", () => {
  for (const offset of [-300, 0, 330, 345, 600]) {
    for (const { day, cents } of dailyTotals(orders, offset)) {
      const sum = ordersOn(orders, day, offset).reduce((s, o) => s + o.cents, 0);
      assert.equal(sum, cents, `offset ${offset}, ${day}`);
    }
  }
});
test("ordersOn in India", () => {
  assert.deepEqual(
    ordersOn(orders, "2026-03-02", 330).map((o) => o.cents),
    [200, 400, 800],
  );
});
