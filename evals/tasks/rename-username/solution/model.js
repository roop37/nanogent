export function createUser({ username, email }) {
  return { id: crypto.randomUUID(), username, email, createdAt: new Date(0).toISOString() };
}
