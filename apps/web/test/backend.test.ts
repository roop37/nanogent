import { createRunId, DEFAULT_LIMITS, RunSpecSchema } from "@nanogent/core";
import { connectPostgres } from "@nanogent/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerAvailable, startPostgres } from "../../../packages/store/test/postgres";
import { createApi } from "../lib/server/api";
import { createBackend } from "../lib/server/backend";
import { type GitHubConfig, seal } from "../lib/server/github-auth";
import { connectionScope, createProjectStore } from "../lib/server/project-store";
import { settings } from "../lib/server/settings";

function spec(cost = 0.1) {
  return RunSpecSchema.parse({
    id: createRunId(),
    repo: { url: "https://github.com/example/calc" },
    task: "Fix addition",
    model: "claude-haiku-5-5",
    effort: "medium",
    limits: { ...DEFAULT_LIMITS, maxCostUsd: cost },
  });
}
describe.skipIf(!dockerAvailable)("web Postgres admission", () => {
  let pg: Awaited<ReturnType<typeof startPostgres>>;
  beforeAll(async () => {
    pg = await startPostgres();
  });
  afterAll(async () => {
    await pg?.stop();
  });
  it("reads owner-scoped live metrics", async () => {
    const owner = crypto.randomUUID();
    const run = spec();
    const backend = createBackend(pg.db);
    await backend.submit(run, owner);
    await pg.store.setState(run.id, "running");
    await pg.store.emit(run.id, {
      type: "model.response",
      data: {
        messageId: "test",
        model: run.model,
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.02 },
      },
    });
    await pg.store.emit(run.id, {
      type: "tool.call",
      data: { toolCallId: "test", name: "bash", risk: "exec", input: { command: "npm test" } },
    });
    expect(await backend.get(crypto.randomUUID(), run.id)).toBeUndefined();
    expect(await backend.list(crypto.randomUUID())).toEqual([]);
    const view = await backend.get(owner, run.id);
    expect(view?.progress).toEqual({ turns: 1, toolCalls: 1, costUsd: 0.02 });
    expect(view).not.toHaveProperty("ownerId");
    expect((await backend.list(owner))[0]?.spec.id).toBe(run.id);
    expect(await backend.allowance(owner)).toEqual({ activeCount: 1, charged: 0.1 });
  });
  it("counts terminal event cost without a result and keeps old active budgets reserved", async () => {
    const owner = crypto.randomUUID();
    const backend = createBackend(pg.db);
    const pending = spec(0.4);
    await backend.submit(pending, owner);
    await pg.pool.query(
      "update runs set created_at=now()-interval '2 days', updated_at=now()-interval '2 days' where id=$1",
      [pending.id],
    );
    const terminal = spec();
    await backend.submit(terminal, owner);
    await pg.store.setState(terminal.id, "running");
    await pg.store.emit(terminal.id, {
      type: "model.response",
      data: {
        messageId: "test",
        model: terminal.model,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.2 },
      },
    });
    await pg.store.setState(terminal.id, "failed");
    expect(await backend.allowance(owner)).toEqual({ activeCount: 1, charged: 0.6 });
    await pg.pool.query("update runs set updated_at=now()-interval '2 days' where id=$1", [
      terminal.id,
    ]);
    expect(await backend.allowance(owner)).toEqual({ activeCount: 1, charged: 0.4 });
  });
  it("checks more than the latest 100 displayed rows", async () => {
    const owner = crypto.randomUUID();
    const backend = createBackend(pg.db);
    for (let i = 0; i < 101; i++) {
      const run = spec(0.01);
      await pg.store.create(run, { ownerId: owner });
    }
    expect(await backend.allowance(owner)).toEqual({ activeCount: 101, charged: 1.01 });
    expect(await backend.list(owner)).toHaveLength(100);
  });
  it("serializes competing submissions from separate database pools", async () => {
    const owner = crypto.randomUUID();
    const other = connectPostgres(pg.url);
    try {
      const backends = [createBackend(pg.db), createBackend(other.db)];
      const responses = await Promise.all(
        backends.map((backend) =>
          createApi({
            session: async () => ({ user: { id: owner } }),
            settings: () => settings({}),
            withBackend: async (work) => work(backend),
          })(
            "submit",
            new Request("http://localhost/api/runs", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                repoUrl: "https://github.com/example/calc",
                task: "Fix addition",
                maxCostUsd: 0.6,
              }),
            }),
          ),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([202, 429]);
      expect(await backends[0]?.allowance(owner)).toEqual({ activeCount: 1, charged: 0.6 });
    } finally {
      await other.pool.end();
    }
  });

  it("isolates project imports and connections by owner and preserves the pinned commit on retry", async () => {
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    const store = createProjectStore(pg.db);
    const first = {
      installationId: "7",
      repositoryId: "21",
      fullName: "example/calc",
      branch: "main",
      commitSha: "a".repeat(40),
    };
    await store.save(owner, [first]);
    const [saved] = await store.list(owner);
    expect(saved).toMatchObject(first);
    if (!saved) throw new Error("Expected a project");
    await store.save(owner, [{ ...first, commitSha: "b".repeat(40) }]);
    await store.save(other, [first]);
    expect(await store.list(owner)).toEqual([saved]);
    expect(await store.get(other, saved.id)).toBeUndefined();
    expect(await store.list(other)).toHaveLength(1);

    const backend = createBackend(pg.db);
    const firstSession = spec();
    const secondSession = spec();
    await backend.submit(firstSession, owner, saved.id);
    await backend.submit(secondSession, owner, saved.id);
    await backend.submit(spec(), owner);
    const sessions = await backend.list(owner, saved.id);
    expect(sessions).toHaveLength(2);
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spec: firstSession, projectId: saved.id }),
        expect.objectContaining({ spec: secondSession, projectId: saved.id }),
      ]),
    );
    expect(await backend.list(other, saved.id)).toEqual([]);
    await expect(backend.submit(spec(), other, saved.id)).rejects.toThrow("Project not found");

    const config: GitHubConfig = {
      slug: "fixture",
      clientId: "fixture",
      clientSecret: "fixture",
      origin: "https://example.invalid",
      key: Buffer.alloc(32),
    };
    await store.connect({
      ownerId: owner,
      login: "example",
      expiresAt: new Date(Date.now() + 3_600_000),
      credentials: seal(config.key, connectionScope(owner), {
        access: "fixture_access",
        refresh: "fixture_refresh",
      }),
    });
    expect(await store.access(owner, config)).toEqual({
      login: "example",
      token: "fixture_access",
    });
    expect(await store.access(other, config)).toBeNull();
    await store.disconnect(owner);
    expect(await store.access(owner, config)).toBeNull();
    expect(await store.get(owner, saved.id)).toEqual(saved);
  });
});
