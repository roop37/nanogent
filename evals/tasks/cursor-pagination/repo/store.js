export function createStore() {
  let nextId = 1;
  const items = new Map();
  return {
    add(name) {
      const item = { id: nextId++, name };
      items.set(item.id, item);
      return item;
    },
    remove(id) {
      return items.delete(id);
    },
    // All items, ordered by id.
    all() {
      return [...items.values()].sort((a, b) => a.id - b.id);
    },
  };
}
