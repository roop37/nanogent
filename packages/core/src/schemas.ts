import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { TerminalStateSchema } from "./state.js";

export const NonNegativeIntegerSchema = z.number().int().nonnegative();
export const NonNegativeNumberSchema = z.number().finite().nonnegative();
const positiveInteger = z.number().int().positive();
const nonempty = z.string().refine((value) => value.trim().length > 0, "Must not be blank");

export const LimitsSchema = z.strictObject({
  maxTurns: positiveInteger,
  maxToolCalls: positiveInteger,
  maxCostUsd: z.number().finite().positive(),
  maxInputTokens: positiveInteger,
  maxOutputTokens: positiveInteger,
  maxWallClockSec: z.number().finite().positive(),
  commandTimeoutSec: z.number().finite().positive(),
  maxToolOutputBytes: positiveInteger,
});
export type Limits = z.infer<typeof LimitsSchema>;
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxTurns: 60,
  maxToolCalls: 150,
  maxCostUsd: 2,
  maxInputTokens: 3_000_000,
  maxOutputTokens: 200_000,
  maxWallClockSec: 1800,
  commandTimeoutSec: 300,
  maxToolOutputBytes: 30_000,
});

export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;
export const ToolRiskSchema = z.enum(["read", "write", "exec", "network", "external"]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;
export const PermissionDecisionSchema = z.enum(["allow", "deny", "ask"]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
export const PermissionPolicySchema = z.strictObject({
  default: PermissionDecisionSchema,
  tools: z.record(nonempty, PermissionDecisionSchema),
  risks: z.partialRecord(ToolRiskSchema, PermissionDecisionSchema),
});
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;
export const DEFAULT_POLICY: Readonly<PermissionPolicy> = Object.freeze({
  default: "deny",
  tools: Object.freeze({}),
  risks: Object.freeze({
    read: "allow",
    write: "allow",
    exec: "allow",
    network: "deny",
    external: "deny",
  }),
});

/** Explicit tool rules override risk rules, which override the fallback. */
export function permissionFor(
  policy: PermissionPolicy,
  tool: { name: string; risk: ToolRisk },
): PermissionDecision {
  if (Object.hasOwn(policy.tools, tool.name)) return policy.tools[tool.name] ?? policy.default;
  return policy.risks[tool.risk] ?? policy.default;
}

export const RepoSchema = z.union([
  z.strictObject({ url: z.url(), ref: nonempty.optional() }),
  z.strictObject({ localPath: nonempty, ref: nonempty.optional() }),
]);
export const RunSpecSchema = z.strictObject({
  id: RunIdSchema,
  repo: RepoSchema,
  task: nonempty,
  setupCommands: z.array(nonempty).default([]),
  verifyCommand: nonempty.optional(),
  model: nonempty,
  effort: EffortSchema,
  refusalFallback: z.boolean().default(false),
  limits: LimitsSchema.default({ ...DEFAULT_LIMITS }),
  policy: PermissionPolicySchema.default(() => ({
    default: DEFAULT_POLICY.default,
    tools: {},
    risks: { ...DEFAULT_POLICY.risks },
  })),
});
export type RunSpec = z.infer<typeof RunSpecSchema>;

/** Input is uncached input; cache buckets are separate, never double-counted for cost. */
export const TokenUsageSchema = z.strictObject({
  input: NonNegativeIntegerSchema,
  output: NonNegativeIntegerSchema,
  cacheRead: NonNegativeIntegerSchema,
  cacheWrite: NonNegativeIntegerSchema,
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export const UsageSchema = TokenUsageSchema.extend({ costUsd: NonNegativeNumberSchema });
export type Usage = z.infer<typeof UsageSchema>;

export const ExecResultSchema = z.strictObject({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
});
export type ExecResult = z.infer<typeof ExecResultSchema>;
export const VerifyResultSchema = z.strictObject({
  command: nonempty,
  exitCode: z.number().int().nullable(),
  output: z.string(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;
export const RunResultSchema = z
  .strictObject({
    status: TerminalStateSchema,
    summary: z.string(),
    diff: z.string(),
    verify: VerifyResultSchema.nullable(),
    verified: z.boolean(),
    usage: UsageSchema,
    turns: NonNegativeIntegerSchema,
    toolCalls: NonNegativeIntegerSchema,
    durationMs: NonNegativeNumberSchema,
    failureReason: nonempty.optional(),
  })
  .refine(
    (result) =>
      result.verified === (result.status === "completed" && result.verify?.exitCode === 0),
    {
      message: "Verified means completed with successful harness verification",
      path: ["verify"],
    },
  )
  .refine(
    (result) =>
      result.status !== "completed" || result.verify === null || result.verify.exitCode === 0,
    { message: "Completed verification must pass" },
  )
  .refine((result) => result.status !== "failed" || result.failureReason !== undefined, {
    message: "Failed runs require a failure reason",
    path: ["failureReason"],
  });
export type RunResult = z.infer<typeof RunResultSchema>;
