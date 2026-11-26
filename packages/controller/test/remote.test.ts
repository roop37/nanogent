import { verifyWake, WAKE_HEADER } from "@nanogent/core";
import { expect, it, vi } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { httpRunnerNotifier, RemoteController } from "../src/remote.js";

function setup() {
  const { spec } = runtime();
  const store = {
    create: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    requestCancel: vi.fn(async () => ({})),
  };
  // biome-ignore lint/suspicious/noExplicitAny: the controller only uses these three store methods
  return { spec, store, controller: new RemoteController(store as any) };
}

it("saves the run and its creation event, and returns the id", async () => {
  const { controller, spec, store } = setup();
  const ownerId = crypto.randomUUID();
  expect(await controller.submit(spec, { ownerId })).toBe(spec.id);
  expect(store.create).toHaveBeenCalledWith(spec, { ownerId });
  expect(store.emit).toHaveBeenCalledWith(spec.id, { type: "run.created", data: { spec } });
  expect(store.create.mock.invocationCallOrder[0]).toBeLessThan(
    store.emit.mock.invocationCallOrder[0] ?? 0,
  );
});

it("rejects an invalid spec before touching the store", async () => {
  const { controller, spec, store } = setup();
  await expect(controller.submit({ ...spec, task: "" })).rejects.toThrow();
  expect(store.create).not.toHaveBeenCalled();
});

it("cancel records the request in the store", async () => {
  const { controller, spec, store } = setup();
  await controller.cancel(spec.id);
  expect(store.requestCancel).toHaveBeenCalledWith(spec.id);
});

it("nudges the runner after the run is saved, and a failed nudge doesn't fail the submit", async () => {
  const { spec, store } = setup();
  const wake = vi.fn(async () => {
    throw new Error("runner down");
  });
  // biome-ignore lint/suspicious/noExplicitAny: partial store
  const controller = new RemoteController(store as any, { wake });
  expect(await controller.submit(spec)).toBe(spec.id);
  expect(wake).toHaveBeenCalledWith(spec.id);
  expect(store.emit.mock.invocationCallOrder[0]).toBeLessThan(
    wake.mock.invocationCallOrder[0] ?? 0,
  );
});

it("the HTTP notifier posts a signed body to the runner", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
  const notifier = httpRunnerNotifier({
    url: "http://runner.example:8787/wake",
    secret: "k".repeat(32),
    fetch: fetchMock as unknown as typeof fetch,
  });
  await notifier.wake("run_abc");
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://runner.example:8787/wake");
  expect(init.method).toBe("POST");
  expect(init.body).toBe('{"runId":"run_abc"}');
  const signature = (init.headers as Record<string, string>)[WAKE_HEADER];
  expect(verifyWake("k".repeat(32), signature, init.body as string)).toBe(true);
});
