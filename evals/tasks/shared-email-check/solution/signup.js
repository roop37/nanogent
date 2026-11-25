import { isEmail } from "./email.js";

export function canSignUp(form) {
  return isEmail(form.email);
}
