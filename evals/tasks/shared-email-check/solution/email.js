// One local part, one @, and a domain with at least one dot and no empty labels. No spaces.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isEmail(value) {
  return typeof value === "string" && EMAIL.test(value.trim());
}
