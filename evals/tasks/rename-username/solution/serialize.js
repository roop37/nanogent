export function toJson(user) {
  return { id: user.id, username: user.username, email: user.email };
}
