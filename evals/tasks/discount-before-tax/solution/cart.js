// All amounts are integer cents.
export function total(items, { taxRate = 0, discountPercent = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
  const discounted = Math.round(subtotal - subtotal * (discountPercent / 100));
  return Math.round(discounted + discounted * taxRate);
}
