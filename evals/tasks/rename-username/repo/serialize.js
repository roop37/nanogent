export function toJson(user) {
  return { id: user.id, userName: user.userName, email: user.email };
}
