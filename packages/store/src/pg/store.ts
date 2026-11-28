import {
  assertTransition,
  type DraftSnapshot,
  DraftSnapshotSchema,
  type RunEvent,
  type RunEventInput,
  RunEventSchema,
  RunIdSchema,
  type RunRecord,
  type RunResult,
  RunResultSchema,
  type RunSpec,
  RunSpecSchema,
  type RunState,
  RunStateSchema,
  type RunStore,
  redact,
} from "@nanogent/core";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type RunDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<RunDatabase["transaction"]>[0]>[0];
export interface StoredRun extends RunRecord {
  ownerId: string | null;
  projectId: string | null;
  sessionId: string | null;
  draftVersion: number | null;
  cancelRequested: boolean;
}
const terminal = (state: RunState) => ["completed", "failed", "canceled"].includes(state);

export class PostgresRunStore implements RunStore {
  constructor(
    readonly db: RunDatabase,
    private readonly secrets: readonly string[] = [],
  ) {}

  async withExecutionLock<T>(runId: string, work: () => Promise<T>): Promise<T | undefined> {
    RunIdSchema.parse(runId);
    return this.db.transaction(async (tx) => {
      const lock = sql<boolean>`pg_try_advisory_xact_lock(hashtextextended(${runId}, 0))`;
      const [row] = await tx
        .select({ acquired: lock })
        .from(schema.runs)
        .where(eq(schema.runs.id, runId));
      if (!row) throw new Error("Run not found");
      if (!row.acquired) return undefined;
      return work();
    });
  }
  private clean(value: unknown): unknown {
    if (typeof value === "string") {
      for (const secret of this.secrets)
        if (secret) value = (value as string).replaceAll(secret, "[REDACTED]");
      return redact(value as string);
    }
    if (Array.isArray(value)) return value.map((item) => this.clean(item));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.clean(item)]),
      );
    return value;
  }
  async create(
    spec: RunSpec,
    options: { ownerId?: string; projectId?: string; sessionId?: string } = {},
  ): Promise<void> {
    const valid = RunSpecSchema.parse(this.clean(RunSpecSchema.parse(spec)));
    let draft: DraftSnapshot | null = null;
    if (options.sessionId) {
      const [session] =
        options.ownerId && options.projectId
          ? await this.db
              .select({
                version: schema.projectSessions.draftVersion,
                files: schema.projectSessions.draftFiles,
              })
              .from(schema.projectSessions)
              .innerJoin(schema.projects, eq(schema.projects.id, schema.projectSessions.projectId))
              .where(
                and(
                  eq(schema.projectSessions.id, options.sessionId),
                  eq(schema.projects.id, options.projectId),
                  eq(schema.projects.ownerId, options.ownerId),
                ),
              )
          : [];
      if (!session) throw new Error("Session not found");
      if (session.version > 0) draft = DraftSnapshotSchema.parse(session);
    } else if (options.projectId) {
      const [project] = options.ownerId
        ? await this.db
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(
              and(
                eq(schema.projects.id, options.projectId),
                eq(schema.projects.ownerId, options.ownerId),
              ),
            )
        : [];
      if (!project) throw new Error("Project not found");
    }
    const row = {
      id: valid.id,
      spec: valid,
      ownerId: options.ownerId ?? null,
      projectId: options.projectId ?? null,
      sessionId: options.sessionId ?? null,
      draftVersion: draft?.version ?? null,
    };
    if (draft) {
      const snapshot = draft;
      await this.db.transaction(async (tx) => {
        await tx.insert(schema.runs).values(row);
        await tx.insert(schema.runDrafts).values({ runId: valid.id, snapshot });
      });
    } else await this.db.insert(schema.runs).values(row);
  }
  async draft(runId: string): Promise<DraftSnapshot | undefined> {
    const [row] = await this.db
      .select({ snapshot: schema.runDrafts.snapshot })
      .from(schema.runDrafts)
      .where(eq(schema.runDrafts.runId, RunIdSchema.parse(runId)));
    return row && DraftSnapshotSchema.parse(row.snapshot);
  }
  private async locked(tx: Transaction, runId: string) {
    const [row] = await tx
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, RunIdSchema.parse(runId)))
      .for("update");
    if (!row) throw new Error("Run not found");
    return row;
  }
  private async lastSeq(tx: Transaction, runId: string) {
    const [last] = await tx
      .select({ seq: schema.runEvents.seq })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId))
      .orderBy(desc(schema.runEvents.seq))
      .limit(1);
    return last?.seq ?? 0;
  }
  private async insert(tx: Transaction, row: typeof schema.runs.$inferSelect, input: RunEvent) {
    const event = RunEventSchema.parse(this.clean(RunEventSchema.parse(input)));
    const last = await this.lastSeq(tx, row.id);
    if (event.seq !== last + 1)
      throw new Error("Event sequence must be contiguous; duplicate or out-of-order seq");
    if (terminal(row.state)) throw new Error("Run is terminal");
    if (event.type === "run.state_changed") {
      if (row.state !== event.data.from) throw new Error("Stale state transition");
      assertTransition(row.state, event.data.to);
      await tx.update(schema.runs).set({ state: event.data.to }).where(eq(schema.runs.id, row.id));
    }
    if (event.type === "run.result") {
      if (row.result) throw new Error("Run already has a result");
      await tx.update(schema.runs).set({ result: event.data }).where(eq(schema.runs.id, row.id));
    }
    await tx.insert(schema.runEvents).values(event);
    await tx.update(schema.runs).set({ updatedAt: new Date() }).where(eq(schema.runs.id, row.id));
  }
  async append(event: RunEvent): Promise<void> {
    RunEventSchema.parse(event);
    await this.db.transaction(async (tx) =>
      this.insert(tx, await this.locked(tx, event.runId), event),
    );
  }
  async emit(runId: string, input: RunEventInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.locked(tx, runId);
      await this.insert(
        tx,
        row,
        RunEventSchema.parse({
          ...input,
          runId,
          seq: (await this.lastSeq(tx, runId)) + 1,
          ts: new Date().toISOString(),
        }),
      );
    });
  }
  async setState(runId: string, state: RunState): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.locked(tx, runId);
      assertTransition(row.state, state);
      await this.insert(
        tx,
        row,
        RunEventSchema.parse({
          runId,
          seq: (await this.lastSeq(tx, runId)) + 1,
          ts: new Date().toISOString(),
          type: "run.state_changed",
          data: { from: row.state, to: state },
        }),
      );
    });
  }
  async finish(runId: string, result: RunResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.locked(tx, runId);
      assertTransition(row.state, result.status);
      const seq = (await this.lastSeq(tx, runId)) + 1;
      const ts = new Date().toISOString();
      await this.insert(
        tx,
        row,
        RunEventSchema.parse({ runId, seq, ts, type: "run.result", data: result }),
      );
      await this.insert(
        tx,
        row,
        RunEventSchema.parse({
          runId,
          seq: seq + 1,
          ts,
          type: "run.state_changed",
          data: { from: row.state, to: result.status },
        }),
      );
    });
  }
  async get(runId: string): Promise<StoredRun | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, RunIdSchema.parse(runId)));
    return row ? this.record(row) : undefined;
  }
  private record(row: typeof schema.runs.$inferSelect): StoredRun {
    return {
      spec: RunSpecSchema.parse(row.spec),
      state: RunStateSchema.parse(row.state),
      ...(row.result ? { result: RunResultSchema.parse(row.result) } : {}),
      ownerId: row.ownerId,
      projectId: row.projectId,
      sessionId: row.sessionId,
      draftVersion: row.draftVersion,
      cancelRequested: row.cancelRequested,
    };
  }
  async *events(runId: string, fromSeq = 1): AsyncIterable<RunEvent> {
    RunIdSchema.parse(runId);
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) throw new Error("Invalid event cursor");
    const [last] = await this.db
      .select({ seq: schema.runEvents.seq })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId))
      .orderBy(desc(schema.runEvents.seq))
      .limit(1);
    const end = last?.seq ?? 0;
    let cursor = fromSeq;
    while (true) {
      const page = await this.db
        .select()
        .from(schema.runEvents)
        .where(
          and(
            eq(schema.runEvents.runId, runId),
            gte(schema.runEvents.seq, cursor),
            lte(schema.runEvents.seq, end),
          ),
        )
        .orderBy(schema.runEvents.seq)
        .limit(100);
      for (const row of page) {
        const event = RunEventSchema.parse({ ...row, ts: new Date(row.ts).toISOString() });
        yield event;
        cursor = event.seq + 1;
      }
      if (page.length < 100) return;
    }
  }
  async list(
    options: { ownerId?: string; projectId?: string; sessionId?: string; limit?: number } = {},
  ): Promise<StoredRun[]> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Invalid list limit");
    if ((options.projectId || options.sessionId) && !options.ownerId)
      throw new Error("Project runs require an owner");
    const rows = await this.db
      .select()
      .from(schema.runs)
      .where(
        and(
          options.ownerId === undefined ? undefined : eq(schema.runs.ownerId, options.ownerId),
          options.projectId === undefined
            ? undefined
            : eq(schema.runs.projectId, options.projectId),
          options.sessionId === undefined
            ? undefined
            : eq(schema.runs.sessionId, options.sessionId),
        ),
      )
      .orderBy(desc(schema.runs.createdAt), desc(schema.runs.id))
      .limit(limit);
    return rows.map((row) => this.record(row));
  }
  /** Ids of runs a runner should look at: queued ones, and active ones in case their worker died. */
  async listRunnable(limit = 20): Promise<{ id: string; state: RunState }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid limit");
    const rows = await this.db
      .select({ id: schema.runs.id, state: schema.runs.state })
      .from(schema.runs)
      .where(inArray(schema.runs.state, ["queued", "running", "awaiting_approval"]))
      .orderBy(schema.runs.createdAt, schema.runs.id)
      .limit(limit);
    return rows.map((row) => ({ id: row.id, state: RunStateSchema.parse(row.state) }));
  }
  async requestCancel(runId: string): Promise<StoredRun> {
    await this.db.transaction(async (tx) => {
      const row = await this.locked(tx, runId);
      if (terminal(row.state) || row.cancelRequested) return;
      await tx.update(schema.runs).set({ cancelRequested: true }).where(eq(schema.runs.id, runId));
      await this.insert(
        tx,
        row,
        RunEventSchema.parse({
          runId,
          seq: (await this.lastSeq(tx, runId)) + 1,
          ts: new Date().toISOString(),
          type: "log",
          data: { level: "info", message: "Cancellation requested" },
        }),
      );
      if (row.state === "queued") {
        await this.insert(
          tx,
          row,
          RunEventSchema.parse({
            runId,
            seq: (await this.lastSeq(tx, runId)) + 1,
            ts: new Date().toISOString(),
            type: "run.state_changed",
            data: { from: "queued", to: "canceled" },
          }),
        );
      }
    });
    const record = await this.get(runId);
    if (!record) throw new Error("Run not found");
    return record;
  }
}
