import Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vitest";
import { message, runtime, toolCall } from "../../core/test/runtime.js";
import { builtInTools } from "../../harness/src/tools.js";
import { ClaudeBrain, type MessageRequest, type MessagesClient } from "../src/index.js";

function scripted(responses: (ReturnType<typeof message> | Error)[]) {
  const requests: MessageRequest[] = [];
  const client: MessagesClient = {
    stream: vi.fn((request) => {
      requests.push(request);
      return {
        finalMessage: async () => {
          const response = responses.shift();
          if (!response) throw new Error("Script exhausted");
          if (response instanceof Error) throw response;
          return response;
        },
      };
    }),
  };
  return { client, requests, brain: new ClaudeBrain(client, 1) };
}
it("preserves assistant content identity, groups results, and records usage", async () => {
  const first = message([
    { type: "thinking", thinking: "reason", signature: "signature" },
    toolCall("bash", { command: "pwd" }, "a"),
    toolCall("bash", { command: "ls" }, "b"),
  ]);
  const fake = scripted([first, message([toolCall("submit", { summary: "fixed" })])]);
  const { ctx, events } = runtime();
  expect(await fake.brain.run({ ...ctx, tools: builtInTools() })).toMatchObject({
    status: "submitted",
    summary: "fixed",
  });
  expect(fake.requests[1]?.messages[1]?.content).toBe(first.content);
  expect(fake.requests[1]?.messages[2]?.content).toHaveLength(2);
  expect(fake.requests[0]).toMatchObject({
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
  });
  expect(ctx.budget.snapshot().usage).toMatchObject({
    input: 20,
    output: 10,
    cacheRead: 4,
    cacheWrite: 6,
  });
  expect(events.filter((event) => event.type === "model.response")).toHaveLength(2);
});
it.each(["max_tokens", "refusal"] as const)("never executes tools on %s", async (reason) => {
  const { brain } = scripted([message([toolCall("bash", { command: "danger" })], reason)]);
  const { ctx, sandbox } = runtime();
  expect(await brain.run({ ...ctx, tools: builtInTools() })).toMatchObject({
    status: "failed",
    failureReason: expect.stringContaining(reason),
  });
  expect(sandbox.bash).not.toHaveBeenCalled();
});
it("continues pause_turn unchanged and nudges end_turn once", async () => {
  const paused = message([], "pause_turn");
  const fake = scripted([paused, message([], "end_turn"), message([], "end_turn")]);
  expect(await fake.brain.run({ ...runtime().ctx, tools: builtInTools() })).toMatchObject({
    status: "failed",
    failureReason: "No submit after reminder",
  });
  expect(fake.requests).toHaveLength(3);
  expect(fake.requests[1]?.messages).toHaveLength(2);
  expect(fake.requests[1]?.messages[1]?.content).toBe(paused.content);
});
it("returns validation failures and unknown tools as one error result message", async () => {
  const fake = scripted([
    message([toolCall("bash", { command: 1 }, "a"), toolCall("unknown", {}, "b")]),
    message([toolCall("submit", { summary: "done" })]),
  ]);
  const { ctx, sandbox } = runtime();
  await fake.brain.run({ ...ctx, tools: builtInTools() });
  expect(sandbox.bash).not.toHaveBeenCalled();
  expect(fake.requests[1]?.messages[2]?.content).toEqual([
    expect.objectContaining({ is_error: true }),
    expect.objectContaining({ is_error: true }),
  ]);
});
it.each([
  "claude-haiku-5-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
])("configures fallback for %s", async (model) => {
  for (const refusalFallback of [true, false]) {
    const fake = scripted([message([toolCall("submit", { summary: "done" })])]);
    const { ctx, events } = runtime({ model, refusalFallback });
    await fake.brain.run({ ...ctx, tools: builtInTools() });
    expect(fake.requests[0]?.fallbacks).toBe(
      refusalFallback && !model.includes("haiku") ? "default" : undefined,
    );
    expect(events.filter((e) => e.type === "log")).toHaveLength(
      refusalFallback && model.includes("haiku") ? 1 : 0,
    );
  }
});
it.each([
  new Anthropic.RateLimitError(429, {}, "rate", new Headers()),
  new Anthropic.InternalServerError(500, {}, "server", new Headers()),
  new Anthropic.APIConnectionError({ message: "connection" }),
  new SyntaxError("invalid JSON"),
])("retries a transient or JSON error once", async (error) => {
  const fake = scripted([error, message([toolCall("submit", { summary: "done" })])]);
  expect(await fake.brain.run({ ...runtime().ctx, tools: builtInTools() })).toMatchObject({
    status: "submitted",
  });
  expect(fake.requests).toHaveLength(2);
});
it("fails fast on 4xx and bounds outer retries", async () => {
  for (const error of [
    new Anthropic.AuthenticationError(401, {}, "auth", new Headers()),
    new Anthropic.RateLimitError(429, {}, "rate", new Headers()),
  ]) {
    const fake = scripted([error, error, message([])]);
    expect(await fake.brain.run({ ...runtime().ctx, tools: builtInTools() })).toMatchObject({
      status: "failed",
    });
    expect(fake.requests).toHaveLength(error.status === 401 ? 1 : 2);
  }
});
it("stops on cost breach before running tools", async () => {
  const { ctx, spec, sandbox } = runtime();
  const limited = runtime({ limits: { ...spec.limits, maxCostUsd: 0.000001 } });
  const fake = scripted([message([toolCall("bash", { command: "pwd" })])]);
  expect(await fake.brain.run({ ...limited.ctx, tools: builtInTools() })).toMatchObject({
    status: "failed",
    failureReason: "budget: maxCostUsd",
  });
  expect(limited.sandbox.bash).not.toHaveBeenCalled();
  expect(limited.events.some((e) => e.type === "budget.exceeded")).toBe(true);
  expect(ctx.budget.snapshot().toolCalls).toBe(0);
  expect(sandbox.bash).not.toHaveBeenCalled();
});
it("honors cancellation before a model request", async () => {
  const fake = scripted([]);
  const { ctx, abort } = runtime();
  abort.abort();
  expect(await fake.brain.run({ ...ctx, tools: [] })).toMatchObject({ status: "canceled" });
  expect(fake.requests).toHaveLength(0);
});
