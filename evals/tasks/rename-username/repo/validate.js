export function validateUser(input) {
  const errors = [];
  if (typeof input.userName !== "string" || input.userName.length < 3)
    errors.push("userName must be at least 3 characters");
  if (typeof input.email !== "string" || !input.email.includes("@"))
    errors.push("email is invalid");
  return errors;
}
