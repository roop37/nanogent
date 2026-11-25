import { formatPrice } from "./money.js";

export function renderInvoice(invoice) {
  const lines = invoice.items.map((item) => `${item.name}: ${formatPrice(item.cents)}`);
  const total = invoice.items.reduce((sum, item) => sum + item.cents, 0);
  return [...lines, `Total: ${formatPrice(total)}`].join("\n");
}
