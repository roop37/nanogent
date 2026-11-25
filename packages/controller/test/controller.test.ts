import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brain, RunEvent } from "@nanogent/core";
import { afterEach, expect, it } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { JsonlRunStore } from "../../store/src/index.js";
import { LocalController } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup(brain: Brain) {
  const home = await mkdtemp(join(tmpdir(), "nanogent-controller-"));
  dirs.push(home);
  const fixture = runtime({ verifyCommand: "node --test" });
  const store = new JsonlRunStore(home);
  return {
    ...fixture,
    store,
    controller: new LocalController(store, brain, { create: async () => fixture.sandbox }),
  };
}
it("submits, follows, persists results and replays a finished run", async () => {
  const { controller, spec, store } = await setup({
    run: async () => ({ status: "submitted", summary: "done" }),
  });
  const id = await controller.submit(spec);
  const events: RunEvent[] = [];
  for await (const e of controller.watch(id)) events.push(e);
  expect(events[0]?.type).toBe("run.created");
  expect(events.at(-1)).toMatchObject({ type: "run.state_changed", data: { to: "completed" } });
  expect(await store.get(id)).toMatchObject({ state: "completed", result: { verified: true } });
  const replay: RunEvent[] = [];
  for await (const e of controller.watch(id)) replay.push(e);
  expect(replay).toEqual(events);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
});
it.each(["allow", "deny"] as const)("resolves an ask policy with %s", async (decision) => {
  const { controller, spec, sandbox } = await setup({
    run: async (ctx) => {
      const bash = ctx.tools.find((t) => t.name === "bash");
      try {
        await bash?.run({ command: "pwd" }, { ...ctx, runId: ctx.spec.id });
        return { status: "submitted", summary: "done" };
      } catch {
        return { status: "failed", summary: "denied", failureReason: "denied" };
      }
    },
  });
  spec.policy.tools.bash = "ask";
  const id = await controller.submit(spec);
  const states: string[] = [];
  for await (const event of controller.watch(id)) {
    if (event.type === "run.state_changed") states.push(event.data.to);
    if (event.type === "approval.requested") {
      await controller.approve(id, event.data.approvalId, decision);
      await expect(controller.approve(id, event.data.approvalId, decision)).rejects.toThrow(
        "not pending",
      );
    }
  }
  expect(states).toContain("awaiting_approval");
  expect(states.at(-1)).toBe(decision === "allow" ? "completed" : "failed");
  expect(sandbox.bash).toHaveBeenCalledTimes(decision === "allow" ? 1 : 0);
});
it("cancels while waiting for approval and cleans up", async () => {
  const { controller, spec, sandbox, store } = await setup({
    run: async (ctx) => {
      try {
        await ctx.tools
          .find((t) => t.name === "bash")
          ?.run({ command: "pwd" }, { ...ctx, runId: ctx.spec.id });
      } catch {}
      return { status: "canceled", summary: "" };
    },
  });
  spec.policy.tools.bash = "ask";
  const id = await controller.submit(spec);
  for await (const event of controller.watch(id))
    if (event.type === "approval.requested") await controller.cancel(id);
  expect(await store.get(id)).toMatchObject({ state: "canceled" });
  expect(sandbox.destroy).toHaveBeenCalledOnce();
});
it("validates specs before creating a run", async () => {
  const { controller, spec, store } = await setup({
    run: async () => ({ status: "submitted", summary: "" }),
  });
  await expect(controller.submit({ ...spec, task: "" })).rejects.toThrow();
  expect(await store.list()).toEqual([]);
});
