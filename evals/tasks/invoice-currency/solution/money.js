const SYMBOLS = { USD: "$", EUR: "€", INR: "₹" };

export function formatPrice(cents, currency = "USD") {
  const symbol = SYMBOLS[currency];
  if (!symbol) throw new Error(`Unsupported currency: ${currency}`);
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
