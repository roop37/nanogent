import { type RunEvent, RunEventSchema } from "@nanogent/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { connectPostgres, PostgresRunStore } from "../src/index.js";
import { dockerAvailable, startPostgres } from "./postgres.js";

const collect = async (source: AsyncIterable<RunEvent>) => {
  const events: RunEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
};
describe.skipIf(!dockerAvailable)("Postgres store", () => {
  let pg: Awaited<ReturnType<typeof startPostgres>>;
  beforeAll(async () => {
    pg = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await pg?.stop();
  });
  it("persists redacted spec, nested events, result and diff with inclusive cursors", async () => {
    const { spec } = runtime({ task: "synthetic-secret sk-ant-testvalue" });
    await pg.store.create(spec);
    await pg.store.setState(spec.id, "running");
    await pg.store.emit(spec.id, {
      type: "tool.call",
      data: {
        name: "bash",
        toolCallId: "t",
        risk: "exec",
        input: { nested: ["synthetic-secret", "Bearer token123"] },
      },
    });
    const result = {
      status: "completed" as const,
      summary: "synthetic-secret",
      diff: "+sk-ant-testvalue",
      verified: false,
      verify: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      turns: 1,
      toolCalls: 1,
      durationMs: 1,
    };
    await pg.store.emit(spec.id, { type: "run.result", data: result });
    await pg.store.setState(spec.id, "completed");
    const restarted = new PostgresRunStore(pg.db);
    expect(await restarted.get(spec.id)).toMatchObject({
      state: "completed",
      result: { summary: "[REDACTED]", diff: "+[REDACTED]" },
    });
    const events = await collect(restarted.events(spec.id, 2));
    expect(events.map((e) => e.seq)).toEqual([2, 3, 4]);
    const raw = JSON.stringify([
      ...(await pg.pool.query("select * from runs where id = $1", [spec.id])).rows,
      ...(await pg.pool.query("select * from run_events where run_id = $1", [spec.id])).rows,
    ]);
    for (const secret of ["synthetic-secret", "sk-ant-testvalue", "token123"])
      expect(raw).not.toContain(secret);
    expect(await restarted.get(runtime().spec.id)).toBeUndefined();
  });
  it("rejects duplicates, gaps, stale states, illegal transitions and terminal writes", async () => {
    const { spec } = runtime();
    await pg.store.create(spec);
    await expect(pg.store.create(spec)).rejects.toThrow();
    await expect(pg.store.setState(spec.id, "completed")).rejects.toThrow("Illegal");
    const event = RunEventSchema.parse({
      runId: spec.id,
      seq: 2,
      ts: new Date().toISOString(),
      type: "log",
      data: { level: "info", message: "hello" },
    });
    await expect(pg.store.append(event)).rejects.toThrow("sequence");
    await pg.store.setState(spec.id, "running");
    await pg.store.append(event);
    await expect(pg.store.append(event)).rejects.toThrow("duplicate");
    await expect(
      pg.pool.query(
        "insert into run_events select * from run_events where run_id = $1 and seq = 2",
        [spec.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pg.store.append(
        RunEventSchema.parse({
          ...event,
          seq: 3,
          type: "run.state_changed",
          data: { from: "queued", to: "running" },
        }),
      ),
    ).rejects.toThrow("Stale");
    await pg.store.setState(spec.id, "failed");
    await expect(pg.store.setState(spec.id, "running")).rejects.toThrow("Illegal");
    await expect(pg.store.append({ ...event, seq: 4 })).rejects.toThrow("terminal");
    await expect(pg.store.get("../../escape")).rejects.toThrow();
    await expect(collect(pg.store.events(spec.id, 0))).rejects.toThrow("cursor");
  });
  it("serializes transitions from separate connections so only one wins", async () => {
    const { spec } = runtime();
    await pg.store.create(spec);
    await pg.store.setState(spec.id, "running");
    const other = connectPostgres(pg.url);
    try {
      const results = await Promise.allSettled([
        pg.store.setState(spec.id, "failed"),
        new PostgresRunStore(other.db).setState(spec.id, "completed"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await collect(pg.store.events(spec.id))).toHaveLength(2);
    } finally {
      await other.pool.end();
    }
  });
  it("paginates events and filters and limits owners", async () => {
    const ownerId = crypto.randomUUID();
    const { spec } = runtime();
    await pg.store.create(spec, { ownerId });
    await pg.store.create(runtime().spec, { ownerId: crypto.randomUUID() });
    for (let i = 0; i < 205; i++)
      await pg.store.emit(spec.id, { type: "log", data: { level: "info", message: String(i) } });
    expect((await collect(pg.store.events(spec.id, 99))).map((e) => e.seq)).toEqual(
      Array.from({ length: 107 }, (_, i) => i + 99),
    );
    expect(await pg.store.list({ ownerId, limit: 10 })).toMatchObject([
      { spec: { id: spec.id }, ownerId },
    ]);
    expect(await pg.store.list({ limit: 1 })).toHaveLength(1);
  });
});
