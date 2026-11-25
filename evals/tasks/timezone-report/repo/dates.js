// "YYYY-MM-DD" for a millisecond timestamp.
export function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

// Moves a UTC timestamp by a timezone offset given in minutes (e.g. +330 for India, -300 for New York in winter).
export function shift(timestamp, minutes) {
  return timestamp - minutes * 60_000;
}
