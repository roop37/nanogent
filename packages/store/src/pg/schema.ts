import type { RunResult, RunSpec, RunState } from "@nanogent/core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    ownerId: uuid("owner_id"),
    spec: jsonb("spec").$type<RunSpec>().notNull(),
    state: text("state").$type<RunState>().notNull().default("queued"),
    result: jsonb("result").$type<RunResult>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    triggerRunId: text("trigger_run_id"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
  },
  (table) => [index("runs_owner_created_idx").on(table.ownerId, table.createdAt)],
);

export const runEvents = pgTable(
  "run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "string" }).notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);
