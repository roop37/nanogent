import { createRunId, RunSpecSchema } from "@nanogent/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cancel } from "../app/api/runs/[id]/cancel/route";
import { GET as events } from "../app/api/runs/[id]/events/route";
import { GET as get } from "../app/api/runs/[id]/route";
import { GET as list, POST as submit } from "../app/api/runs/route";
import { type Backend, createApi } from "../lib/server/api";
import type { Session } from "../lib/server/guard";
import { settings } from "../lib/server/settings";
import type { RunView } from "../lib/types";

const runtime = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../lib/server/runtime", () => runtime);
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const input = {
  repoUrl: "https://github.com/example/calc",
  task: "Fix addition",
  model: "claude-haiku-5-5",
  maxCostUsd: 0.1,
};
let session: Session;
let backend: Backend;
let records: Map<string, { owner: string; run: RunView }>;
let charged: number;
let activeCount: number;
let config: ReturnType<typeof settings>;
function request(path = "/api/runs", body?: unknown, extra: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", ...extra },
  });
}
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}
function addRun(id = createRunId(), user = owner): RunView {
  const now = new Date().toISOString();
  const run: RunView = {
    spec: RunSpecSchema.parse({
      id,
      repo: { url: input.repoUrl },
      task: input.task,
      model: input.model,
      effort: "medium",
    }),
    state: "queued",
    createdAt: now,
    updatedAt: now,
    cancelRequested: false,
    progress: { turns: 0, toolCalls: 0, costUsd: 0 },
  };
  records.set(id, { owner: user, run });
  return run;
}
beforeEach(() => {
  vi.clearAllMocks();
  session = { user: { id: owner } };
  records = new Map();
  charged = 0;
  activeCount = 0;
  config = settings({});
  let queue = Promise.resolve();
  backend = {
    list: vi.fn(async (user) =>
      [...records.values()]
        .filter((record) => record.owner === user)
        .map((r) => r.run)
        .reverse(),
    ),
    get: vi.fn(async (user, id) =>
      records.get(id)?.owner === user ? records.get(id)?.run : undefined,
    ),
    events: vi.fn(async (_id, from) => ({ events: [], nextSeq: from, hasMore: false })),
    cancel: vi.fn(async () => {}),
    allowance: vi.fn(async () => ({ charged, activeCount })),
    withOwnerLock: async (_user, work) => {
      const result = queue.then(work);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    submit: vi.fn(async (spec, user) => {
      const run = addRun(spec.id, user);
      run.spec = spec;
      activeCount++;
      charged += spec.limits.maxCostUsd;
      return spec.id;
    }),
  };
  runtime.api.mockImplementation(
    createApi({
      session: async () => session,
      settings: () => config,
      withBackend: async (work) => work(backend),
    }),
  );
});
describe("run route handlers", () => {
  it("requires auth on every run endpoint before accessing storage", async () => {
    session = null;
    const id = createRunId();
    for (const response of await Promise.all([
      list(request()),
      submit(request("/api/runs", input)),
      get(request(), context(id)),
      events(request(), context(id)),
      cancel(request(), context(id)),
    ])) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(backend.get).not.toHaveBeenCalled();
    expect(backend.list).not.toHaveBeenCalled();
    expect(backend.submit).not.toHaveBeenCalled();
  });
  it("scopes the list and all item endpoints to the session owner", async () => {
    const mine = addRun();
    const theirs = addRun(createRunId(), other);
    const response = await list(request());
    expect((await response.json()).runs.map((r: RunView) => r.spec.id)).toEqual([mine.spec.id]);
    for (const handler of [get, events, cancel])
      expect((await handler(request(), context(theirs.spec.id))).status).toBe(404);
    expect(backend.events).not.toHaveBeenCalled();
    expect(backend.cancel).not.toHaveBeenCalled();
    expect((await get(request(), context(mine.spec.id))).status).toBe(200);
    expect(backend.get).toHaveBeenCalledWith(owner, mine.spec.id);
  });
  it("submits a validated spec with server-owned identity and limits", async () => {
    const response = await submit(
      request("/api/runs", { ...input, setupCommands: ["npm ci"], verifyCommand: "npm test" }),
    );
    expect(response.status).toBe(202);
    expect(backend.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: input.task,
        verifyCommand: "npm test",
        refusalFallback: false,
        limits: expect.objectContaining({ maxCostUsd: 0.1 }),
        policy: expect.objectContaining({ default: "deny" }),
      }),
      owner,
    );
  });
  it.each([
    { repoUrl: "http://github.com/example/repo" },
    { repoUrl: "https://user:password@github.com/example/repo" },
    { repoUrl: "https://127.0.0.1/repo" },
    { repoUrl: "https://github.com.evil.test/repo/test" },
    { repoUrl: "https://github.com/example/repo?token=private" },
    { repoUrl: "file:///tmp/repo" },
    { task: " " },
    { task: "a".repeat(12001) },
    { maxCostUsd: 0 },
    { maxCostUsd: 2 },
    { maxCostUsd: "0.1" },
    { model: "claude-opus-5-5" },
    { model: "unknown" },
    { ownerId: other },
    { limits: { maxTurns: 10000 } },
    { setupCommands: Array(11).fill("npm ci") },
    { verifyCommand: " " },
  ])("rejects invalid input %j", async (change) => {
    expect((await submit(request("/api/runs", { ...input, ...change }))).status).toBe(400);
    expect(backend.submit).not.toHaveBeenCalled();
  });
  it("offers only Sonnet in production and still enforces the cost ceiling", async () => {
    config = settings({ NANOGENT_ENV: "production" });
    expect(
      (await submit(request("/api/runs", { ...input, model: "claude-sonnet-5-5" }))).status,
    ).toBe(202);
    expect(
      (await submit(request("/api/runs", { ...input, model: "claude-opus-5-5" }))).status,
    ).toBe(400);
    expect(
      (await submit(request("/api/runs", { ...input, model: "claude-haiku-5-5" }))).status,
    ).toBe(400);
    expect((await submit(request("/api/runs", { ...input, maxCostUsd: 1.01 }))).status).toBe(400);
  });
  it("rejects malformed JSON, wrong content type, and oversized bodies", async () => {
    expect(
      (
        await submit(
          new Request("http://localhost:3000/api/runs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await submit(request("/api/runs", input, { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
    expect((await submit(request("/api/runs", { task: "x".repeat(40001) }))).status).toBe(413);
  });
  it("rejects cross-origin mutations", async () => {
    expect(
      (await submit(request("/api/runs", input, { origin: "https://other.test" }))).status,
    ).toBe(403);
    expect(
      (
        await cancel(
          request("/api/runs", {}, { "sec-fetch-site": "cross-site" }),
          context(addRun().spec.id),
        )
      ).status,
    ).toBe(403);
    expect(backend.submit).not.toHaveBeenCalled();
    expect(backend.cancel).not.toHaveBeenCalled();
  });
  it("enforces the three-active-run limit under concurrent submissions", async () => {
    activeCount = 2;
    const results = await Promise.all([
      submit(request("/api/runs", input)),
      submit(request("/api/runs", input)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(backend.submit).toHaveBeenCalledTimes(1);
  });
  it("reserves daily budget atomically and allows the exact remaining amount", async () => {
    charged = 0.9;
    const results = await Promise.all([
      submit(request("/api/runs", input)),
      submit(request("/api/runs", input)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(charged).toBe(1);
  });
  it("honors the configured daily cap", async () => {
    config = settings({ NANOGENT_DAILY_CAP_USD: "0.25" });
    charged = 0.2;
    expect((await submit(request("/api/runs", input))).status).toBe(429);
  });
  it("keeps the saved ID and reservation when the start is uncertain", async () => {
    backend.submit = vi.fn(async (spec) => {
      addRun(spec.id);
      throw new Error("private service details");
    });
    const response = await submit(request("/api/runs", input));
    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.id).toBeTruthy();
    expect(data.warning).toContain("saved");
    expect(JSON.stringify(data)).not.toContain("private service details");
  });
  it("hides infrastructure errors", async () => {
    backend.list = vi.fn().mockRejectedValue(new Error("private database details"));
    const response = await list(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });
  it("passes an inclusive event cursor and rejects malformed cursors", async () => {
    const id = addRun().spec.id;
    const response = await events(request(`/api/runs/${id}/events?from=7`), context(id));
    expect(response.status).toBe(200);
    expect(backend.events).toHaveBeenCalledWith(id, 7);
    for (const from of ["0", "-1", "1.5", "abc", "", "9007199254740992"]) {
      expect(
        (await events(request(`/api/runs/${id}/events?from=${from}`), context(id))).status,
      ).toBe(400);
    }
  });
  it("cancels only the owned run and rejects invalid IDs", async () => {
    const id = addRun().spec.id;
    expect((await cancel(request(), context(id))).status).toBe(200);
    expect(backend.cancel).toHaveBeenCalledWith(id);
    expect((await get(request(), context("../../private"))).status).toBe(404);
  });
});
