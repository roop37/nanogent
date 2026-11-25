const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ after: id })).toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const { after } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Number.isInteger(after)) return after;
  } catch {}
  throw new Error("Invalid cursor");
}

export function listItems(store, { limit = DEFAULT_LIMIT, cursor } = {}) {
  const size = Math.min(Math.max(1, limit), MAX_LIMIT);
  const after = cursor === undefined || cursor === null ? 0 : decodeCursor(cursor);
  const remaining = store.all().filter((item) => item.id > after);
  const items = remaining.slice(0, size);
  const nextCursor = remaining.length > size ? encodeCursor(items[items.length - 1].id) : null;
  return { items, nextCursor };
}
