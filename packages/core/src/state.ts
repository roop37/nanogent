import { z } from "zod";

export const RunStateSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "canceled",
]);
export type RunState = z.infer<typeof RunStateSchema>;
export const TerminalStateSchema = z.enum(["completed", "failed", "canceled"]);
export type TerminalState = z.infer<typeof TerminalStateSchema>;

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  queued: Object.freeze(["running", "canceled"] as const),
  running: Object.freeze(["awaiting_approval", "completed", "failed", "canceled"] as const),
  awaiting_approval: Object.freeze(["running", "failed", "canceled"] as const),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  canceled: Object.freeze([]),
});

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new Error(`Illegal run transition: ${from} -> ${to}`);
}
