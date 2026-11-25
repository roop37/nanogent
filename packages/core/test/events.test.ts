import { describe, expect, it } from "vitest";
import { type RunEventInput, RunEventSchema } from "../src/index.js";
import { result, runId, spec, usage, verify } from "./fixtures.js";

const payloads = [
  { type: "run.created", data: { spec } },
  { type: "run.state_changed", data: { from: "queued", to: "running" } },
  { type: "sandbox.ready", data: { sandboxId: "sandbox-1" } },
  { type: "model.response", data: { messageId: "msg-1", model: spec.model, usage } },
  {
    type: "tool.call",
    data: { toolCallId: "call-1", name: "view", risk: "read", input: { path: "a.ts" } },
  },
  {
    type: "tool.result",
    data: { toolCallId: "call-1", output: "ok", isError: false, truncated: false, durationMs: 1 },
  },
  {
    type: "approval.requested",
    data: { approvalId: "approval-1", toolCallId: "call-1", name: "push", risk: "external" },
  },
  { type: "approval.resolved", data: { approvalId: "approval-1", decision: "deny" } },
  { type: "budget.exceeded", data: { reason: "maxTurns", limit: 60, actual: 60 } },
  { type: "verify.result", data: verify },
  { type: "run.result", data: result },
  { type: "log", data: { level: "info", message: "started" } },
] satisfies RunEventInput[];
const envelope = { runId, seq: 1, ts: "2026-11-25T12:00:00.000Z" };

describe("run events", () => {
  it.each(payloads)("validates $type and rejects missing data", (payload) => {
    const event = { ...envelope, ...payload };
    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(RunEventSchema.safeParse({ ...event, data: {} }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ ...event, data: { ...event.data, unexpected: 1 } }).success,
    ).toBe(false);
  });
  it.each([
    { runId: "../invalid" },
    { seq: 0 },
    { seq: -1 },
    { seq: 1.5 },
    { ts: "yesterday" },
    { ts: "2026-11-25T12:00:00" },
    { type: "unknown" },
    { extra: "unexpected" },
  ])("rejects invalid envelope: %j", (override) => {
    expect(RunEventSchema.safeParse({ ...envelope, ...payloads[11], ...override }).success).toBe(
      false,
    );
  });
  it("rejects invalid transitions and mismatched run creation", () => {
    expect(
      RunEventSchema.safeParse({
        ...envelope,
        type: "run.state_changed",
        data: { from: "completed", to: "running" },
      }).success,
    ).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...envelope,
        type: "run.created",
        data: { spec: { ...spec, id: "run_00m0000001_0123456789abcdef01234567" } },
      }).success,
    ).toBe(false);
  });
  it("rejects malformed typed event payloads", () => {
    for (const payload of [
      { type: "approval.resolved", data: { approvalId: "a", decision: "ask" } },
      {
        type: "model.response",
        data: { messageId: "m", model: spec.model, usage: { ...usage, input: -1 } },
      },
      { type: "budget.exceeded", data: { reason: "unknown", limit: 1, actual: 2 } },
      {
        type: "tool.call",
        data: { toolCallId: "c", name: "view", risk: "read", input: undefined },
      },
      {
        type: "tool.result",
        data: { toolCallId: "c", output: "", isError: false, truncated: false, durationMs: -1 },
      },
    ])
      expect(RunEventSchema.safeParse({ ...envelope, ...payload }).success).toBe(false);
  });
});
