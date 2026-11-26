import { createRunId, type RunEvent } from "@nanogent/core";
import { expect, it } from "vitest";
import { eventPage } from "../lib/server/event-page";

it("drains bounded inclusive pages without losing or repeating the lookahead event", async () => {
  const runId = createRunId();
  let closed = 0;
  async function* events(from: number): AsyncIterable<RunEvent> {
    try {
      for (let seq = from; seq <= 205; seq++)
        yield {
          runId,
          seq,
          ts: new Date().toISOString(),
          type: "log",
          data: { level: "info", message: String(seq) },
        };
    } finally {
      closed++;
    }
  }
  const first = await eventPage(events(1), 1);
  expect(first.events).toHaveLength(100);
  expect(first.nextSeq).toBe(101);
  expect(first.hasMore).toBe(true);
  const second = await eventPage(events(first.nextSeq), first.nextSeq);
  expect(second.events[0]?.seq).toBe(101);
  expect(second.nextSeq).toBe(201);
  expect(second.hasMore).toBe(true);
  const last = await eventPage(events(second.nextSeq), second.nextSeq);
  expect(last.events.map((e) => e.seq)).toEqual([201, 202, 203, 204, 205]);
  expect(last.nextSeq).toBe(206);
  expect(last.hasMore).toBe(false);
  expect(await eventPage(events(206), 206)).toEqual({ events: [], nextSeq: 206, hasMore: false });
  expect(closed).toBe(4);
});
