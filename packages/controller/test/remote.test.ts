import type { StoredRun } from "@nanogent/store";
import { expect, it, vi } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { RemoteController } from "../src/remote.js";

function setup() {
  const { spec } = runtime();
  const record: StoredRun = {
    spec,
    state: "queued",
    ownerId: null,
    triggerRunId: null,
    cancelRequested: false,
  };
  const store = {
    create: vi.fn(async () => {}),
    get: vi.fn(async () => record),
    emit: vi.fn(async () => {}),
    bindTrigger: vi.fn(async (_id: string, handle: string) => {
      record.triggerRunId = handle;
    }),
    requestCancel: vi.fn(async () => {
      record.cancelRequested = true;
      return record;
    }),
  };
  const sdk = { trigger: vi.fn(async () => ({ id: "trigger_1" })), cancel: vi.fn(async () => {}) };
  return { spec, record, store, sdk, controller: new RemoteController(store, sdk) };
}
it("stores the run before triggering with its idempotency key", async () => {
  const { controller, spec, store, sdk } = setup();
  const ownerId = crypto.randomUUID();
  expect(await controller.submit(spec, { ownerId })).toBe(spec.id);
  expect(store.create).toHaveBeenCalledWith(spec, { ownerId });
  expect(sdk.trigger).toHaveBeenCalledWith(
    "execute-run",
    { runId: spec.id },
    { idempotencyKey: spec.id },
  );
  expect(store.bindTrigger).toHaveBeenCalledWith(spec.id, "trigger_1");
  expect(store.create.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.trigger.mock.invocationCallOrder[0] ?? 0,
  );
});
it("persists cancellation before canceling Trigger and retries the same handle", async () => {
  const { controller, spec, sdk, store } = setup();
  await controller.submit(spec);
  sdk.cancel.mockRejectedValueOnce(new Error("transport"));
  await expect(controller.cancel(spec.id)).rejects.toThrow("transport");
  await controller.cancel(spec.id);
  expect(sdk.cancel).toHaveBeenCalledTimes(2);
  expect(sdk.cancel).toHaveBeenLastCalledWith("trigger_1");
  expect(store.requestCancel.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.cancel.mock.invocationCallOrder[0] ?? 0,
  );
});
it("can re-enqueue after an ambiguous trigger error using the same key", async () => {
  const { controller, spec, store, sdk } = setup();
  sdk.trigger.mockRejectedValueOnce(new Error("transport"));
  await expect(controller.submit(spec)).rejects.toThrow("transport");
  await controller.enqueue(spec.id);
  expect(store.create).toHaveBeenCalledTimes(1);
  expect(sdk.trigger.mock.calls[0]).toEqual(sdk.trigger.mock.calls[1]);
});
it("cancels a handle returned after cancellation was requested", async () => {
  const { controller, spec, sdk, record } = setup();
  sdk.trigger.mockImplementationOnce(async () => {
    record.cancelRequested = true;
    return { id: "trigger_1" };
  });
  await controller.submit(spec);
  expect(sdk.cancel).toHaveBeenCalledWith("trigger_1");
});
it("does not enqueue terminal runs", async () => {
  const { controller, spec, sdk, record } = setup();
  record.state = "completed";
  await controller.enqueue(spec.id);
  expect(sdk.trigger).not.toHaveBeenCalled();
});
