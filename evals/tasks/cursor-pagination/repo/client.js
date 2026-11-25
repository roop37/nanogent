import { listItems } from "./api.js";

// Reads every item, one page at a time.
export function fetchAll(store, pageSize = 20) {
  const out = [];
  let offset = 0;
  while (offset !== null) {
    const page = listItems(store, { limit: pageSize, offset });
    out.push(...page.items);
    offset = page.nextOffset;
  }
  return out;
}
