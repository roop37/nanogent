import { setTimeout as delay } from "node:timers/promises";
import type { Brain } from "@nanogent/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runtime } from "../../../packages/core/test/runtime.js";
import { dockerAvailable, startPostgres } from "../../../packages/store/test/postgres.js";
import { executeStoredRun } from "../src/execute.js";

describe.skipIf(!dockerAvailable)("stored executor", () => {
  let pg: Awaited<ReturnType<typeof startPostgres>>;
  beforeAll(async () => {
    pg = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await pg?.stop();
  });
  const setup = async (overrides = {}) => {
    const rt = runtime({
      repo: { url: "https://github.com/example/public.git" },
      verifyCommand: "npm test",
      ...overrides,
    });
    await pg.store.create(rt.spec);
    const brain: Brain = {
      run: vi.fn(async (ctx) => {
        ctx.budget.recordTurn();
        ctx.budget.recordUsage({
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          costUsd: 0.01,
        });
        await ctx.events.emit({
          type: "model.response",
          data: { messageId: "m", model: ctx.spec.model, usage: ctx.budget.snapshot().usage },
        });
        return { status: "submitted" as const, summary: "fixed" };
      }),
    };
    const provider = { create: vi.fn(async () => rt.sandbox) };
    return { ...rt, brain, provider, store: pg.store };
  };
  it("verifies and persists every event with realtime progress, then skips terminal redelivery", async () => {
    const deps = await setup();
    const progress = vi.fn(async () => {});
    const result = await executeStoredRun(deps.spec.id, { ...deps, progress });
    expect(result).toMatchObject({ status: "completed", verified: true, diff: "+fixed", turns: 1 });
    expect(await pg.store.get(deps.spec.id)).toMatchObject({ state: "completed", result });
    const events = [];
    for await (const event of pg.store.events(deps.spec.id)) events.push(event);
    expect(events.map((e) => e.type)).toEqual([
      "run.state_changed",
      "sandbox.ready",
      "model.response",
      "verify.result",
      "run.result",
      "run.state_changed",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress).toHaveBeenCalledWith({ state: "running", turns: 1, costUsd: 0.01 });
    expect(progress).toHaveBeenLastCalledWith({ state: "completed", turns: 1, costUsd: 0.01 });
    await executeStoredRun(deps.spec.id, deps);
    expect(deps.brain.run).toHaveBeenCalledTimes(1);
    expect(deps.sandbox.destroy).toHaveBeenCalledTimes(1);
  });
  it("fails interrupted runs without invoking the model", async () => {
    const deps = await setup();
    await pg.store.setState(deps.spec.id, "running");
    await pg.store.emit(deps.spec.id, {
      type: "model.response",
      data: {
        messageId: "prior",
        model: deps.spec.model,
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.025 },
      },
    });
    const result = await executeStoredRun(deps.spec.id, deps);
    expect(result?.failureReason).toContain("Previous worker stopped");
    expect(result).toMatchObject({ turns: 1, usage: { costUsd: 0.025 } });
    expect((await pg.store.get(deps.spec.id))?.state).toBe("failed");
    expect(deps.brain.run).not.toHaveBeenCalled();
    expect(deps.provider.create).not.toHaveBeenCalled();
  });
  it.each(["signal", "request"])("cancels through %s and destroys the sandbox", async (kind) => {
    const deps = await setup();
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.brain.run = vi.fn(async (ctx) => {
      started();
      await delay(10_000, undefined, { signal: ctx.signal });
      return { status: "submitted" as const, summary: "" };
    });
    const done = executeStoredRun(deps.spec.id, { ...deps, signal: deps.abort.signal });
    await running;
    if (kind === "signal") deps.abort.abort();
    else await pg.store.requestCancel(deps.spec.id);
    expect((await done)?.status).toBe("canceled");
    expect(deps.sandbox.destroy).toHaveBeenCalledTimes(1);
    expect((await pg.store.get(deps.spec.id))?.state).toBe("canceled");
  });
  it("ignores a concurrent delivery while the first worker owns the run", async () => {
    const deps = await setup();
    let started: () => void = () => {};
    let finish: () => void = () => {};
    const running = new Promise<void>((r) => {
      started = r;
    });
    const release = new Promise<void>((r) => {
      finish = r;
    });
    deps.brain.run = vi.fn(async () => {
      started();
      await release;
      return { status: "submitted" as const, summary: "done" };
    });
    const done = executeStoredRun(deps.spec.id, deps);
    await running;
    try {
      expect(await executeStoredRun(deps.spec.id, deps)).toBeUndefined();
    } finally {
      finish();
    }
    expect((await done)?.status).toBe("completed");
    expect(deps.brain.run).toHaveBeenCalledTimes(1);
  });
  it("retries only transient setup failures and never retries the brain", async () => {
    const deps = await setup();
    const transient = new Error("temporary");
    deps.provider.create.mockRejectedValueOnce(transient);
    deps.brain.run = vi.fn(async () => {
      throw new Error("model failed");
    });
    const result = await executeStoredRun(deps.spec.id, {
      ...deps,
      retryableSetup: (error) => error === transient,
      setupRetryDelayMs: 1,
    });
    expect(result?.status).toBe("failed");
    expect(deps.provider.create).toHaveBeenCalledTimes(2);
    expect(deps.brain.run).toHaveBeenCalledTimes(1);
    expect(deps.sandbox.destroy).toHaveBeenCalledTimes(1);
  });
  it("does not retry permanent setup errors or start canceled queued work", async () => {
    const deps = await setup();
    deps.provider.create.mockRejectedValue(new Error("invalid repo"));
    await executeStoredRun(deps.spec.id, deps);
    expect(deps.provider.create).toHaveBeenCalledTimes(1);
    expect(deps.brain.run).not.toHaveBeenCalled();
    const canceled = await setup();
    await pg.store.requestCancel(canceled.spec.id);
    await executeStoredRun(canceled.spec.id, canceled);
    expect(canceled.provider.create).not.toHaveBeenCalled();
  });
  it("isolates ten concurrent runs", async () => {
    const inputs = await Promise.all(Array.from({ length: 10 }, () => setup()));
    const results = await Promise.all(inputs.map((deps) => executeStoredRun(deps.spec.id, deps)));
    expect(results.every((result) => result?.status === "completed")).toBe(true);
    for (const deps of inputs) {
      const events = [];
      for await (const event of pg.store.events(deps.spec.id)) events.push(event);
      expect(events.every((event) => event.runId === deps.spec.id)).toBe(true);
      expect(deps.sandbox.destroy).toHaveBeenCalledTimes(1);
    }
  });
});
