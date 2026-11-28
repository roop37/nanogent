import "server-only";
import { randomUUID } from "node:crypto";
import { type PostgresRunStore, postgresSchema as schema } from "@nanogent/store";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Project, ProjectInput, ProjectPin, ProjectSession } from "../projects";
import { withWebDatabase } from "./db";
import { credentialsSchema, exchangeGitHub, type GitHubConfig, seal, unseal } from "./github-auth";
import { HttpError } from "./guard";
import { testMode } from "./settings";

type Connection = typeof schema.githubConnections.$inferSelect;
type Access = { login: string; token: string };

export interface ProjectStore {
  list(owner: string): Promise<Project[]>;
  get(owner: string, id: string): Promise<Project | undefined>;
  save(owner: string, projects: ProjectInput[]): Promise<void>;
  updatePin(owner: string, id: string, expected: ProjectPin, pin: ProjectPin): Promise<boolean>;
  sessions(owner: string, projectId: string): Promise<ProjectSession[]>;
  session(owner: string, projectId: string, id: string): Promise<ProjectSession | undefined>;
  createSession(
    owner: string,
    projectId: string,
    name: string,
  ): Promise<ProjectSession | undefined>;
  connect(row: Connection): Promise<void>;
  disconnect(owner: string): Promise<void>;
  access(owner: string, config: GitHubConfig): Promise<Access | null>;
}

const fields = {
  id: schema.projects.id,
  fullName: schema.projects.fullName,
  branch: schema.projects.branch,
  commitSha: schema.projects.commitSha,
  installationId: schema.projects.installationId,
  repositoryId: schema.projects.repositoryId,
};
const sessionFields = {
  id: schema.projectSessions.id,
  projectId: schema.projectSessions.projectId,
  name: schema.projectSessions.name,
  branch: schema.projectSessions.branch,
  commitSha: schema.projectSessions.commitSha,
};
export const connectionScope = (owner: string) => `github-credentials:${owner}`;

function accessCredentials(row: Connection, config: GitHubConfig) {
  try {
    return credentialsSchema.parse(
      unseal(config.key, connectionScope(row.ownerId), row.credentials),
    );
  } catch {
    throw new HttpError(401, "Reconnect GitHub to continue.");
  }
}

export function createProjectStore(db: PostgresRunStore["db"]): ProjectStore {
  const ownerMatch = (owner: string) => eq(schema.githubConnections.ownerId, owner);
  const fresh = (row: Connection) => row.expiresAt.getTime() > Date.now() + 60_000;
  const ownedProject = (owner: string, id: string) =>
    and(eq(schema.projects.ownerId, owner), eq(schema.projects.id, id));
  const sessionRows = () =>
    db
      .select(sessionFields)
      .from(schema.projectSessions)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectSessions.projectId));
  return {
    list: (owner) =>
      db
        .select(fields)
        .from(schema.projects)
        .where(eq(schema.projects.ownerId, owner))
        .orderBy(asc(schema.projects.fullName)),
    get: async (owner, id) =>
      (await db.select(fields).from(schema.projects).where(ownedProject(owner, id)))[0],
    save: async (owner, projects) => {
      await db
        .insert(schema.projects)
        .values(projects.map((project) => ({ ...project, ownerId: owner })))
        .onConflictDoUpdate({
          target: [schema.projects.ownerId, schema.projects.repositoryId],
          set: { fullName: sql`excluded.full_name`, installationId: sql`excluded.installation_id` },
        });
    },
    updatePin: async (owner, id, expected, pin) => {
      const [updated] = await db
        .update(schema.projects)
        .set(pin)
        .where(
          and(
            ownedProject(owner, id),
            eq(schema.projects.branch, expected.branch),
            eq(schema.projects.commitSha, expected.commitSha),
          ),
        )
        .returning({ id: schema.projects.id });
      return !!updated;
    },
    sessions: (owner, projectId) =>
      sessionRows()
        .where(ownedProject(owner, projectId))
        .orderBy(desc(schema.projectSessions.createdAt), desc(schema.projectSessions.id)),
    session: async (owner, projectId, id) =>
      (
        await sessionRows().where(
          and(ownedProject(owner, projectId), eq(schema.projectSessions.id, id)),
        )
      )[0],
    createSession: async (owner, projectId, name) => {
      const [project] = await db
        .select(fields)
        .from(schema.projects)
        .where(ownedProject(owner, projectId));
      if (!project) return undefined;
      const [session] = await db
        .insert(schema.projectSessions)
        .values({ projectId, name, branch: project.branch, commitSha: project.commitSha })
        .returning(sessionFields);
      return session;
    },
    connect: async (row) => {
      const { ownerId, ...values } = row;
      await db
        .insert(schema.githubConnections)
        .values(row)
        .onConflictDoUpdate({ target: schema.githubConnections.ownerId, set: values });
    },
    disconnect: async (owner) => {
      await db.delete(schema.githubConnections).where(ownerMatch(owner));
    },
    access: async (owner, config) => {
      const [row] = await db.select().from(schema.githubConnections).where(ownerMatch(owner));
      if (!row) return null;
      if (fresh(row)) return { login: row.login, token: accessCredentials(row, config).access };
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [locked] = await tx
          .select()
          .from(schema.githubConnections)
          .where(ownerMatch(owner))
          .for("update");
        if (!locked) return null;
        const current = accessCredentials(locked, config);
        if (fresh(locked)) return { login: locked.login, token: current.access };
        const { credentials, expiresAt } = await exchangeGitHub(config, {
          refresh: current.refresh,
        });
        await tx
          .update(schema.githubConnections)
          .set({ credentials: seal(config.key, connectionScope(owner), credentials), expiresAt })
          .where(ownerMatch(owner));
        return { login: locked.login, token: credentials.access };
      });
    },
  };
}

const testState = globalThis as typeof globalThis & {
  nanogentProjects?: Map<string, Project[]>;
  nanogentProjectSessions?: Map<string, ProjectSession[]>;
  nanogentProjectDisconnected?: Set<string>;
};
function fakeProjectStore(): ProjectStore {
  testState.nanogentProjects ??= new Map();
  testState.nanogentProjectSessions ??= new Map();
  testState.nanogentProjectDisconnected ??= new Set();
  const projects = testState.nanogentProjects;
  const sessions = testState.nanogentProjectSessions;
  const disconnected = testState.nanogentProjectDisconnected;
  return {
    list: async (owner) => projects.get(owner) ?? [],
    get: async (owner, id) => projects.get(owner)?.find((project) => project.id === id),
    save: async (owner, added) => {
      const current = projects.get(owner) ?? [];
      const saved = new Set(current.map((project) => project.repositoryId));
      projects.set(owner, [
        ...current,
        ...added
          .filter((project) => !saved.has(project.repositoryId))
          .map((project) => ({ ...project, id: randomUUID() })),
      ]);
    },
    updatePin: async (owner, id, expected, pin) => {
      const project = projects.get(owner)?.find((entry) => entry.id === id);
      if (
        !project ||
        project.branch !== expected.branch ||
        project.commitSha !== expected.commitSha
      )
        return false;
      Object.assign(project, pin);
      return true;
    },
    sessions: async (owner, projectId) =>
      projects.get(owner)?.some((project) => project.id === projectId)
        ? (sessions.get(projectId) ?? [])
        : [],
    session: async (owner, projectId, id) =>
      projects.get(owner)?.some((project) => project.id === projectId)
        ? sessions.get(projectId)?.find((session) => session.id === id)
        : undefined,
    createSession: async (owner, projectId, name) => {
      const project = projects.get(owner)?.find((candidate) => candidate.id === projectId);
      if (!project) return undefined;
      const session = {
        id: randomUUID(),
        projectId,
        name,
        branch: project.branch,
        commitSha: project.commitSha,
      };
      sessions.set(projectId, [session, ...(sessions.get(projectId) ?? [])]);
      return session;
    },
    connect: async ({ ownerId }) => void disconnected.delete(ownerId),
    disconnect: async (owner) => void disconnected.add(owner),
    access: async (owner) =>
      !owner.endsWith("2") && !disconnected.has(owner)
        ? { login: "example", token: "scripted" }
        : null,
  };
}

export function withProjectStore<T>(work: (store: ProjectStore) => Promise<T>) {
  return testMode()
    ? work(fakeProjectStore())
    : withWebDatabase((db) => work(createProjectStore(db)));
}
