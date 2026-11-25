import { listItems } from "./api.js";

// Reads every item, one page at a time.
export function fetchAll(store, pageSize = 20) {
  const out = [];
  let cursor;
  do {
    const page = listItems(store, { limit: pageSize, cursor });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}
