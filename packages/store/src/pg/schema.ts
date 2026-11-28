import type { RunResult, RunSpec, RunState } from "@nanogent/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    ownerId: uuid("owner_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => projectSessions.id, { onDelete: "set null" }),
    spec: jsonb("spec").$type<RunSpec>().notNull(),
    state: text("state").$type<RunState>().notNull().default("queued"),
    result: jsonb("result").$type<RunResult>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
  },
  (table) => [
    index("runs_owner_created_idx").on(table.ownerId, table.createdAt),
    index("runs_owner_project_created_idx").on(table.ownerId, table.projectId, table.createdAt),
    index("runs_session_created_idx").on(table.sessionId, table.createdAt),
    uniqueIndex("runs_active_session_idx")
      .on(table.sessionId)
      .where(
        sql`${table.sessionId} is not null and ${table.state} in ('queued', 'running', 'awaiting_approval')`,
      ),
  ],
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

export const githubConnections = pgTable("github_connections", {
  ownerId: uuid("owner_id").primaryKey(),
  login: text("login").notNull(),
  credentials: text("credentials").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    installationId: text("installation_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    fullName: text("full_name").notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha").notNull(),
  },
  (table) => [uniqueIndex("projects_owner_repository_idx").on(table.ownerId, table.repositoryId)],
);

export const projectSessions = pgTable(
  "project_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_sessions_project_created_idx").on(table.projectId, table.createdAt)],
);
