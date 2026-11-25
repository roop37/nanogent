export function createUser({ userName, email }) {
  return { id: crypto.randomUUID(), userName, email, createdAt: new Date(0).toISOString() };
}
