import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Budget } from "./budget.js";
import type { RunEvent, RunEventInput } from "./events.js";
import type {
  ExecResult,
  Limits,
  PermissionDecision,
  RunResult,
  RunSpec,
  ToolRisk,
} from "./schemas.js";
import type { RunState } from "./state.js";

/** Redact string payloads, validate, then assign a monotonically increasing seq starting at 1. */
export interface EventSink {
  emit(event: RunEventInput): Promise<void>;
}

export interface Brain {
  run(ctx: AgentContext): Promise<AgentOutcome>;
}

export interface AgentContext {
  readonly spec: RunSpec;
  readonly sandbox: Sandbox;
  readonly tools: readonly Tool[];
  readonly limits: Readonly<Limits>;
  readonly budget: Budget;
  readonly events: EventSink;
  readonly signal: AbortSignal;
  /** Earlier messages must never be edited/dropped; append assistant content unchanged. */
  readonly history: readonly Anthropic.MessageParam[];
}

/** Agent submission is not run completion: the executor must independently verify it. */
export interface AgentOutcome {
  status: "submitted" | "failed" | "canceled";
  summary: string;
  failureReason?: string;
  lastMessage?: Anthropic.Message;
}

export interface ToolContext {
  readonly runId: string;
  readonly sandbox: Sandbox;
  readonly limits: Readonly<Limits>;
  readonly budget: Budget;
  readonly events: EventSink;
  readonly signal: AbortSignal;
}

/** Registry must parse untrusted input with inputSchema and apply policy before calling run. */
export interface Tool<Input = unknown> {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: z.ZodType<Input>;
  readonly modelDefinition?: Anthropic.ToolUnion;
  run(input: Input, ctx: ToolContext): Promise<string>;
}

/** No credentials or model configuration cross the sandbox boundary. */
export type SandboxSpec = Pick<RunSpec, "id" | "repo" | "setupCommands" | "limits">;
export interface SandboxProvider {
  create(spec: SandboxSpec, signal?: AbortSignal): Promise<Sandbox>;
}

export interface ExecOptions {
  timeoutSec: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

/** Paths must be confined to the sandbox workspace; output limits are UTF-8 bytes, not characters. */
export interface Sandbox {
  readonly id: string;
  readonly workspace?: string;
  exec(command: string, options: ExecOptions): Promise<ExecResult>;
  bash(
    command: string | undefined,
    options: ExecOptions & { restart?: boolean },
  ): Promise<ExecResult>;
  readFile(path: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<string>;
  writeFile(path: string, content: string, signal?: AbortSignal): Promise<void>;
  diff(options: { maxBytes: number; signal?: AbortSignal }): Promise<string>;
  /** Idempotent; the executor calls this from finally. */
  destroy(): Promise<void>;
}

export interface RunRecord {
  spec: RunSpec;
  state: RunState;
  result?: RunResult;
}

export interface RunStore {
  create(spec: RunSpec): Promise<void>;
  /** Reject duplicate/out-of-order seq. Persist run.result into the record's result. */
  append(event: RunEvent): Promise<void>;
  /** Enforce the transition table; never overwrite a terminal state. */
  setState(runId: string, state: RunState): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  /** Finite replay in seq order, inclusive fromSeq (default 1). */
  events(runId: string, fromSeq?: number): AsyncIterable<RunEvent>;
  list(): Promise<RunRecord[]>;
}

export interface Controller {
  submit(spec: RunSpec): Promise<string>;
  cancel(runId: string): Promise<void>;
  approve(
    runId: string,
    approvalId: string,
    decision: Exclude<PermissionDecision, "ask">,
  ): Promise<void>;
  /** Replay then follow until terminal; AbortSignal closes a consumer subscription. */
  watch(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent>;
}
