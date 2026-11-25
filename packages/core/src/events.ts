import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import {
  LimitsSchema,
  NonNegativeNumberSchema,
  RunResultSchema,
  RunSpecSchema,
  ToolRiskSchema,
  UsageSchema,
  VerifyResultSchema,
} from "./schemas.js";
import { canTransition, RunStateSchema } from "./state.js";

const eventBase = {
  runId: RunIdSchema,
  seq: z.number().int().positive(),
  ts: z.iso.datetime({ offset: true }),
};
function event<T extends string, S extends z.ZodType>(type: T, data: S) {
  return z.strictObject({ ...eventBase, type: z.literal(type), data });
}
const nonempty = z.string().min(1);
export const RunCreatedEventSchema = event(
  "run.created",
  z.strictObject({ spec: RunSpecSchema }),
).refine((value) => value.runId === value.data.spec.id, {
  message: "Created event run ID must match its spec",
});
export const RunStateChangedEventSchema = event(
  "run.state_changed",
  z
    .strictObject({ from: RunStateSchema, to: RunStateSchema, reason: nonempty.optional() })
    .refine(({ from, to }) => canTransition(from, to), "Illegal run transition"),
);
export const SandboxReadyEventSchema = event(
  "sandbox.ready",
  z.strictObject({ sandboxId: nonempty }),
);
export const ModelResponseEventSchema = event(
  "model.response",
  z.strictObject({ messageId: nonempty, model: nonempty, usage: UsageSchema }),
);
export const ToolCallEventSchema = event(
  "tool.call",
  z.strictObject({ toolCallId: nonempty, name: nonempty, risk: ToolRiskSchema, input: z.json() }),
);
export const ToolResultEventSchema = event(
  "tool.result",
  z.strictObject({
    toolCallId: nonempty,
    output: z.string(),
    isError: z.boolean(),
    truncated: z.boolean(),
    durationMs: NonNegativeNumberSchema,
  }),
);
export const ApprovalRequestedEventSchema = event(
  "approval.requested",
  z.strictObject({
    approvalId: nonempty,
    toolCallId: nonempty,
    name: nonempty,
    risk: ToolRiskSchema,
  }),
);
export const ApprovalResolvedEventSchema = event(
  "approval.resolved",
  z.strictObject({ approvalId: nonempty, decision: z.enum(["allow", "deny"]) }),
);
export const BudgetExceededEventSchema = event(
  "budget.exceeded",
  z.strictObject({
    reason: LimitsSchema.keyof(),
    limit: NonNegativeNumberSchema,
    actual: NonNegativeNumberSchema,
  }),
);
export const VerifyResultEventSchema = event("verify.result", VerifyResultSchema);
export const RunResultEventSchema = event("run.result", RunResultSchema);
export const LogEventSchema = event(
  "log",
  z.strictObject({ level: z.enum(["debug", "info", "warn", "error"]), message: z.string() }),
);

export const RunEventSchema = z.discriminatedUnion("type", [
  RunCreatedEventSchema,
  RunStateChangedEventSchema,
  SandboxReadyEventSchema,
  ModelResponseEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  BudgetExceededEventSchema,
  VerifyResultEventSchema,
  RunResultEventSchema,
  LogEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
/** Producers emit payloads; the run-scoped sink owns sequence and timestamp assignment. */
export type RunEventInput = {
  [T in RunEvent["type"]]: Pick<Extract<RunEvent, { type: T }>, "type" | "data">;
}[RunEvent["type"]];
