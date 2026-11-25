const users = new Map();

export async function signUp(email, mailer) {
  if (users.has(email)) return { ok: false, reason: "exists" };
  users.set(email, { email });
  const result = await mailer.send(email, "Welcome!");
  return { ok: true, emailed: result.ok === true };
}

export function resetUsers() {
  users.clear();
}
