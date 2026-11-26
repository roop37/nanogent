import { describe, expect, it, vi } from "vitest";
import { startRunner } from "../src/runner.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await wait(5);
  }
}

function fakeStore(ids: string[]) {
  const states = new Map(ids.map((id) => [id, "queued"]));
  return {
    states,
    add: (id: string) => states.set(id, "queued"),
    listRunnable: vi.fn(async () =>
      [...states].filter(([, s]) => s !== "done").map(([id, state]) => ({ id, state })),
    ),
  };
}

describe("runner", () => {
  it("starts runs up to the concurrency limit and picks up the next when one finishes", async () => {
    const store = fakeStore(["a", "b", "c"]);
    const release = new Map<string, () => void>();
    const started: string[] = [];
    const runner = startRunner({
      store,
      concurrency: 2,
      busyPollMs: 5,
      sweepMs: 60_000,
      execute: (id) =>
        new Promise((resolve) => {
          started.push(id);
          release.set(id, () => {
            store.states.set(id, "done");
            resolve({ ok: true });
          });
        }),
    });
    await until(() => started.length === 2);
    expect(started).toEqual(["a", "b"]);
    expect(runner.running).toBe(2);
    release.get("a")?.();
    await until(() => started.includes("c"));
    expect(started).toEqual(["a", "b", "c"]);
    release.get("b")?.();
    release.get("c")?.();
    await runner.stop();
  });

  it("never starts the same run twice while it is in progress", async () => {
    const store = fakeStore(["a"]);
    const execute = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<unknown>((resolve) =>
          signal.addEventListener("abort", () => resolve("canceled")),
        ),
    );
    const runner = startRunner({ store, concurrency: 3, busyPollMs: 5, execute, drainMs: 10 });
    await wait(60);
    expect(execute).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it("wakes immediately instead of waiting for the sweep", async () => {
    const store = fakeStore([]);
    const execute = vi.fn(async (id: string) => {
      store.states.set(id, "done");
      return { ok: true };
    });
    const runner = startRunner({ store, execute, sweepMs: 60_000 });
    await wait(30);
    expect(execute).not.toHaveBeenCalled();
    store.add("late");
    runner.wake();
    await until(() => execute.mock.calls.length === 1);
    await runner.stop();
  });

  it("leaves a run alone for a while when another worker holds it", async () => {
    const store = fakeStore(["held"]);
    store.states.set("held", "running");
    const execute = vi.fn(async () => undefined);
    const runner = startRunner({
      store,
      concurrency: 1,
      busyPollMs: 5,
      sweepMs: 5,
      backoffMs: 10_000,
      execute,
    });
    await wait(80);
    expect(execute).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it("keeps going after a failed look-up or a failed run, and logs without throwing", async () => {
    const store = fakeStore(["x"]);
    store.listRunnable.mockRejectedValueOnce(new Error("db down"));
    const logs: string[] = [];
    const execute = vi.fn(async () => {
      store.states.set("x", "done");
      throw new Error("boom");
    });
    const runner = startRunner({
      store,
      concurrency: 1,
      busyPollMs: 5,
      sweepMs: 10,
      execute,
      log: (m) => logs.push(m),
    });
    await until(() => execute.mock.calls.length === 1);
    await runner.stop();
    expect(logs.join("\n")).toContain("look-up failed: db down");
    expect(logs.join("\n")).toContain("x failed: boom");
  });

  it("stop() waits for running work, and cancels it after the drain time", async () => {
    const store = fakeStore(["slow"]);
    let aborted = false;
    const runner = startRunner({
      store,
      drainMs: 40,
      busyPollMs: 5,
      execute: (_id, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve("canceled");
          });
        }),
    });
    await until(() => runner.running === 1);
    const started = Date.now();
    await runner.stop();
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(runner.running).toBe(0);
  });

  it("doesn't start new runs once stopping", async () => {
    const store = fakeStore([]);
    const execute = vi.fn(async () => ({}));
    const runner = startRunner({ store, execute, sweepMs: 5 });
    await runner.stop();
    store.add("after");
    runner.wake();
    await wait(30);
    expect(execute).not.toHaveBeenCalled();
  });
});
