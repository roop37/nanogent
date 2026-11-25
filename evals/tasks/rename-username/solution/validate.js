export function validateUser(input) {
  const errors = [];
  if (typeof input.username !== "string" || input.username.length < 3)
    errors.push("username must be at least 3 characters");
  if (typeof input.email !== "string" || !input.email.includes("@"))
    errors.push("email is invalid");
  return errors;
}
