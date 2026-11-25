const DEFAULT_LIMIT = 20;

export function listItems(store, { limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  const all = store.all();
  const items = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : null;
  return { items, nextOffset };
}
