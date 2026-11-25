import { dayKey, shift } from "./dates.js";

// Sum of order amounts per calendar day in the shop's timezone. Orders look like { at: ISO string, cents }.
export function dailyTotals(orders, tzOffsetMinutes = 0) {
  const totals = {};
  for (const order of orders) {
    const key = dayKey(shift(Date.parse(order.at), tzOffsetMinutes));
    totals[key] = (totals[key] ?? 0) + order.cents;
  }
  return Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, cents]) => ({ day, cents }));
}

// Orders placed on a given calendar day in the shop's timezone.
export function ordersOn(orders, day, tzOffsetMinutes = 0) {
  return orders.filter((order) => dayKey(shift(Date.parse(order.at), tzOffsetMinutes)) === day);
}
