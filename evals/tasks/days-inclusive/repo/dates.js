const DAY = 24 * 60 * 60 * 1000;

// Number of nights between check-in and check-out.
export function nights(checkIn, checkOut) {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY);
}

// Number of calendar days a booking touches, counting both the first and last day.
export function daysTouched(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY);
}
