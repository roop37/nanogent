import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  DEFAULT_LIMITS,
  type Limits,
  LimitsSchema,
  NonNegativeIntegerSchema,
  NonNegativeNumberSchema,
  type Usage,
  UsageSchema,
} from "./schemas.js";

export type BudgetCheck = { ok: true } | { ok: false; reason: keyof Limits };
export interface BudgetSnapshot {
  turns: number;
  toolCalls: number;
  usage: Usage;
  elapsedMs: number;
}
const ObservationSchema = z.strictObject({
  commandDurationMs: NonNegativeNumberSchema.optional(),
  toolOutputBytes: NonNegativeIntegerSchema.optional(),
});
export type BudgetObservation = z.infer<typeof ObservationSchema>;

export class Budget {
  readonly limits: Readonly<Limits>;
  readonly #clock: () => number;
  readonly #startedAt: number;
  #elapsedMs = 0;
  #turns = 0;
  #toolCalls = 0;
  #usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

  constructor(limits: Limits = DEFAULT_LIMITS, clock: () => number = () => performance.now()) {
    this.limits = Object.freeze(LimitsSchema.parse(limits));
    this.#clock = clock;
    this.#startedAt = z.number().finite().parse(clock());
  }

  recordTurn(): void {
    this.#turns = NonNegativeIntegerSchema.parse(this.#turns + 1);
  }

  recordToolCall(): void {
    this.#toolCalls = NonNegativeIntegerSchema.parse(this.#toolCalls + 1);
  }

  recordUsage(delta: Usage): void {
    const valid = UsageSchema.parse(delta);
    this.#usage = UsageSchema.parse({
      input: this.#usage.input + valid.input,
      output: this.#usage.output + valid.output,
      cacheRead: this.#usage.cacheRead + valid.cacheRead,
      cacheWrite: this.#usage.cacheWrite + valid.cacheWrite,
      costUsd: this.#usage.costUsd + valid.costUsd,
    });
  }

  snapshot(): BudgetSnapshot {
    const now = z.number().finite().parse(this.#clock());
    this.#elapsedMs = Math.max(this.#elapsedMs, now - this.#startedAt, 0);
    return {
      turns: this.#turns,
      toolCalls: this.#toolCalls,
      usage: { ...this.#usage },
      elapsedMs: this.#elapsedMs,
    };
  }

  /** Cumulative limits stop at equality; per-command ceilings permit an exact fit. */
  check(observation: BudgetObservation = {}): BudgetCheck {
    const observed = ObservationSchema.parse(observation);
    const { turns, toolCalls, usage, elapsedMs } = this.snapshot();
    const limits = this.limits;
    const totals = [
      ["maxTurns", turns],
      ["maxToolCalls", toolCalls],
      ["maxCostUsd", usage.costUsd],
      ["maxInputTokens", usage.input + usage.cacheRead + usage.cacheWrite],
      ["maxOutputTokens", usage.output],
      ["maxWallClockSec", elapsedMs / 1000],
    ] as const;
    for (const [reason, total] of totals) {
      if (total >= limits[reason]) return { ok: false, reason };
    }
    if ((observed.commandDurationMs ?? 0) > limits.commandTimeoutSec * 1000) {
      return { ok: false, reason: "commandTimeoutSec" };
    }
    if ((observed.toolOutputBytes ?? 0) > limits.maxToolOutputBytes) {
      return { ok: false, reason: "maxToolOutputBytes" };
    }
    return { ok: true };
  }
}
