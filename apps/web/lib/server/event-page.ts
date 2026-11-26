import "server-only";
import type { RunEvent } from "@nanogent/core";
import type { EventPage } from "../types";
export async function eventPage(source: AsyncIterable<RunEvent>, from: number): Promise<EventPage> {
  const events: RunEvent[] = [];
  let hasMore = false;
  for await (const event of source) {
    if (events.length === 100) {
      hasMore = true;
      break;
    }
    events.push(event);
  }
  return { events, nextSeq: (events.at(-1)?.seq ?? from - 1) + 1, hasMore };
}
