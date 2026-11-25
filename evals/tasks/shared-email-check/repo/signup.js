export function canSignUp(form) {
  const email = form.email.trim();
  return email.includes("@") && email.length > 3;
}
