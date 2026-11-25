import { isEmail } from "./email.js";

export function subscribe(list, address) {
  if (!isEmail(address)) return false;
  list.push(address.trim().toLowerCase());
  return true;
}
