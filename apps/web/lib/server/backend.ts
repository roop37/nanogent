import "server-only";
import {
  httpRunnerNotifier,
  RemoteController,
  type RunnerNotifier,
} from "@nanogent/controller/remote";
import { PostgresRunStore, postgresSchema as schema } from "@nanogent/store";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import type { RunView } from "../types";
import type { Backend } from "./api";
import { eventPage } from "./event-page";

neonConfig.webSocketConstructor = ws;
export function createBackend(db: PostgresRunStore["db"], notifier?: RunnerNotifier): Backend {
  const store = new PostgresRunStore(db);
  const controller = new RemoteController(store, notifier);
  async function views(
    owner: string,
    records: Awaited<ReturnType<typeof store.list>>,
  ): Promise<RunView[]> {
    if (records.length === 0) return [];
    const rows = await db
      .select({
        id: schema.runs.id,
        createdAt: schema.runs.createdAt,
        updatedAt: schema.runs.updatedAt,
        turns: sql<number>`count(*) filter (where ${schema.runEvents.type} = 'model.response')::int`,
        toolCalls: sql<number>`count(*) filter (where ${schema.runEvents.type} = 'tool.call')::int`,
        costUsd: sql<string>`coalesce(sum((${schema.runEvents.data}->'usage'->>'costUsd')::numeric) filter (where ${schema.runEvents.type} = 'model.response'), 0)`,
      })
      .from(schema.runs)
      .leftJoin(schema.runEvents, eq(schema.runEvents.runId, schema.runs.id))
      .where(
        and(
          eq(schema.runs.ownerId, owner),
          inArray(
            schema.runs.id,
            records.map((r) => r.spec.id),
          ),
        ),
      )
      .groupBy(schema.runs.id);
    const counts = new Map(rows.map((row) => [row.id, row]));
    return records.flatMap((record) => {
      const row = counts.get(record.spec.id);
      if (!row) return [];
      return [
        {
          spec: record.spec,
          state: record.state,
          ...(record.result ? { result: record.result } : {}),
          cancelRequested: record.cancelRequested,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          progress: record.result
            ? {
                turns: record.result.turns,
                toolCalls: record.result.toolCalls,
                costUsd: record.result.usage.costUsd,
              }
            : { turns: row.turns, toolCalls: row.toolCalls, costUsd: Number(row.costUsd) },
        },
      ];
    });
  }
  const backend: Backend = {
    list: async (owner) => views(owner, await store.list({ ownerId: owner, limit: 100 })),
    get: async (owner, id) => {
      const [owned] = await db
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .where(and(eq(schema.runs.id, id), eq(schema.runs.ownerId, owner)));
      if (!owned) return undefined;
      const record = await store.get(id);
      return record && record.ownerId === owner ? (await views(owner, [record]))[0] : undefined;
    },
    events: (id, from) => eventPage(store.events(id, from), from),
    withOwnerLock: (owner, action) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`web-owner:${owner}`}, 0))`,
        );
        return action();
      }),
    allowance: async (owner) => {
      // Active budgets stay reserved across UTC midnight. Terminal costs are charged on completion day.
      const spent = sql`coalesce((select sum((e.data->'usage'->>'costUsd')::numeric)
        from run_events e where e.run_id = ${schema.runs.id} and e.type = 'model.response'), 0)`;
      const isActive = sql`${schema.runs.state} in ('queued', 'running', 'awaiting_approval')`;
      const [row] = await db
        .select({
          activeCount: sql<number>`count(*) filter (where ${isActive})::int`,
          charged: sql<string>`coalesce(sum(case when ${isActive}
          then greatest((${schema.runs.spec}->'limits'->>'maxCostUsd')::numeric, ${spent})
          when ${schema.runs.updatedAt} >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
          then greatest(coalesce((${schema.runs.result}->'usage'->>'costUsd')::numeric, 0), ${spent})
          else 0 end), 0)`,
        })
        .from(schema.runs)
        .where(eq(schema.runs.ownerId, owner));
      return { activeCount: row?.activeCount ?? 0, charged: Number(row?.charged ?? 0) };
    },
    submit: (spec, ownerId) => controller.submit(spec, { ownerId }),
    cancel: (id) => controller.cancel(id),
  };
  return backend;
}

export async function withProductionBackend<T>(work: (backend: Backend) => Promise<T>): Promise<T> {
  const connectionString = process.env.NANOGENT_DATABASE_URL;
  if (!connectionString) throw new Error("Database is not configured");
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  try {
    return await work(createBackend(drizzle(pool, { schema }), runnerNotifier()));
  } finally {
    await pool.end();
  }
}

// Optional: without these the runner still finds new runs on its next sweep, just later.
function runnerNotifier(): RunnerNotifier | undefined {
  const url = process.env.NANOGENT_RUNNER_URL;
  const secret = process.env.NANOGENT_WAKE_SECRET;
  return url && secret ? httpRunnerNotifier({ url, secret }) : undefined;
}
