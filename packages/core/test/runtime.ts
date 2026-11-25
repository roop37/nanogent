import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import {
  type AgentContext,
  Budget,
  createRunId,
  type ExecResult,
  type RunEventInput,
  RunSpecSchema,
  type Sandbox,
  type ToolContext,
} from "../src/index.js";

export function runtime(overrides: object = {}) {
  const spec = RunSpecSchema.parse({
    id: createRunId(),
    repo: { localPath: "/tmp/repo" },
    task: "Fix validation",
    model: "claude-haiku-5-5",
    effort: "medium",
    ...overrides,
  });
  const events: RunEventInput[] = [];
  const files = new Map<string, string>();
  const execution: ExecResult = {
    exitCode: 0,
    stdout: "passed",
    stderr: "",
    timedOut: false,
    truncated: false,
  };
  const sandbox: Sandbox = {
    id: "fake-sandbox",
    exec: vi.fn(async () => ({ ...execution })),
    bash: vi.fn(async () => ({ ...execution })),
    readFile: vi.fn(async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("Missing file");
      return value;
    }),
    writeFile: vi.fn(async (path, content) => {
      files.set(path, content);
    }),
    diff: vi.fn(async () => "+fixed"),
    destroy: vi.fn(async () => {}),
  };
  const abort = new AbortController();
  const ctx: Omit<AgentContext, "tools"> & ToolContext = {
    spec,
    runId: spec.id,
    sandbox,
    limits: spec.limits,
    budget: new Budget(spec.limits),
    events: {
      emit: async (event: RunEventInput) => {
        events.push(event);
      },
    },
    signal: abort.signal,
    history: [],
  };
  return { ctx, events, sandbox, files, abort, spec, execution };
}
export function message(
  content: Anthropic.Beta.Messages.BetaContentBlock[],
  stop_reason: Anthropic.Beta.Messages.BetaStopReason = "tool_use",
): Anthropic.Beta.Messages.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-haiku-5-5",
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: "standard",
    },
  };
}
export function toolCall(
  name: string,
  input: unknown,
  id = "tool_test",
): Anthropic.Beta.Messages.BetaToolUseBlock {
  return { type: "tool_use", id, name, input, caller: { type: "direct" } };
}
