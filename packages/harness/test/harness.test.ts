import { expect, it, vi } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { builtInTools, Executor, PermissionPolicy, ToolRegistry } from "../src/index.js";

it("supports editor view, create, unique replacement, and insert", async () => {
  const { ctx, files } = runtime();
  const registry = new ToolRegistry(builtInTools(), new PermissionPolicy(ctx.spec.policy));
  const edit = (input: unknown) => registry.execute("str_replace_based_edit_tool", input, ctx);
  await edit({ command: "create", path: "amount.js", file_text: "one\ntwo\nthree" });
  expect(await edit({ command: "view", path: "/workspace/amount.js", view_range: [2, 2] })).toBe(
    "2\ttwo",
  );
  await edit({ command: "str_replace", path: "amount.js", old_str: "two", new_str: "fixed" });
  await edit({ command: "insert", path: "amount.js", insert_line: 0, insert_text: "zero" });
  expect(files.get("/workspace/amount.js")).toBe("zero\none\nfixed\nthree");
  await expect(
    edit({ command: "str_replace", path: "amount.js", old_str: "absent", new_str: "x" }),
  ).rejects.toThrow("exactly once");
  files.set("/workspace/amount.js", "same same");
  await expect(
    edit({ command: "str_replace", path: "amount.js", old_str: "same", new_str: "x" }),
  ).rejects.toThrow("exactly once");
  await expect(
    edit({ command: "insert", path: "amount.js", insert_line: 9, insert_text: "x" }),
  ).rejects.toThrow();
});
it("uses read policy for view and write policy for modifications", async () => {
  const { ctx, files } = runtime();
  files.set("/workspace/x", "content");
  const registry = new ToolRegistry(
    builtInTools(),
    new PermissionPolicy({ default: "deny", tools: {}, risks: { read: "allow", write: "deny" } }),
  );
  expect(
    await registry.execute("str_replace_based_edit_tool", { command: "view", path: "x" }, ctx),
  ).toContain("content");
  await expect(
    registry.execute(
      "str_replace_based_edit_tool",
      { command: "create", path: "x", file_text: "bad" },
      ctx,
    ),
  ).rejects.toThrow("denied");
});
it.each([
  0,
  1,
  null,
])("independently verifies a submission (exit %s) and destroys the sandbox", async (exitCode) => {
  const { ctx, sandbox, spec } = runtime({ verifyCommand: "node --test" });
  vi.mocked(sandbox.exec).mockResolvedValue({
    exitCode,
    stdout: "tests",
    stderr: "",
    timedOut: false,
    truncated: false,
  });
  const transition = vi.fn(async () => {});
  const result = await new Executor().execute(spec, {
    brain: { run: async () => ({ status: "submitted", summary: "done" }) },
    provider: { create: async () => sandbox },
    events: ctx.events,
    transition,
  });
  expect(result.verified).toBe(exitCode === 0);
  expect(result.status).toBe(exitCode === 0 ? "completed" : "failed");
  expect(sandbox.exec).toHaveBeenCalledWith("node --test", expect.anything());
  expect(sandbox.destroy).toHaveBeenCalledOnce();
  expect(transition.mock.calls[0]).toEqual(["running"]);
});
it("completes without a verify command but explicitly marks it unverified", async () => {
  const { ctx, sandbox, spec } = runtime();
  const result = await new Executor().execute(spec, {
    brain: { run: async () => ({ status: "submitted", summary: "done" }) },
    provider: { create: async () => sandbox },
    events: ctx.events,
    transition: async () => {},
  });
  expect(result).toMatchObject({ status: "completed", verified: false, verify: null });
  expect(sandbox.exec).not.toHaveBeenCalled();
});
it.each(["brain", "diff", "cleanup"])("tears down on %s failure", async (failure) => {
  const { ctx, sandbox, spec } = runtime();
  if (failure === "diff") vi.mocked(sandbox.diff).mockRejectedValue(new Error("diff failed"));
  if (failure === "cleanup")
    vi.mocked(sandbox.destroy).mockRejectedValue(new Error("cleanup failed"));
  const result = await new Executor().execute(spec, {
    brain: {
      run: async () => {
        if (failure === "brain") throw new Error("brain failed");
        return { status: "submitted", summary: "done" };
      },
    },
    provider: { create: async () => sandbox },
    events: ctx.events,
    transition: async () => {},
  });
  expect(result.status).toBe("failed");
  expect(sandbox.destroy).toHaveBeenCalledOnce();
});
it("cancels an active run and destroys its sandbox", async () => {
  const { ctx, sandbox, spec, abort } = runtime();
  const result = await new Executor().execute(spec, {
    brain: {
      run: async () => {
        abort.abort();
        return { status: "canceled", summary: "" };
      },
    },
    provider: { create: async () => sandbox },
    events: ctx.events,
    transition: async () => {},
    signal: abort.signal,
  });
  expect(result.status).toBe("canceled");
  expect(sandbox.destroy).toHaveBeenCalledOnce();
});
it("enforces wall time during a model request", async () => {
  const base = runtime();
  const { ctx, sandbox, spec, events } = runtime({
    limits: { ...base.spec.limits, maxWallClockSec: 0.02 },
  });
  const result = await new Executor().execute(spec, {
    brain: {
      run: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    },
    provider: { create: async () => sandbox },
    events: ctx.events,
    transition: async () => {},
  });
  expect(result).toMatchObject({ status: "failed", failureReason: "budget: maxWallClockSec" });
  expect(events.some((e) => e.type === "budget.exceeded")).toBe(true);
  expect(sandbox.destroy).toHaveBeenCalledOnce();
});
