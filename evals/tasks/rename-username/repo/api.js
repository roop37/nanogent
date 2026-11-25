import { createUser } from "./model.js";
import { toJson } from "./serialize.js";
import { validateUser } from "./validate.js";

export function postUser(body) {
  const errors = validateUser(body);
  if (errors.length > 0) return { status: 400, body: { errors } };
  return { status: 201, body: toJson(createUser(body)) };
}
