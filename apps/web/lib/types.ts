import type { RunEvent, RunRecord } from "@nanogent/core";
export interface RunView extends RunRecord {
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  progress: { turns: number; toolCalls: number; costUsd: number };
}
export interface EventPage {
  events: RunEvent[];
  nextSeq: number;
  hasMore: boolean;
}
export const active = (state: string) => ["queued", "running", "awaiting_approval"].includes(state);
export const money = (cost: number) => `$${cost.toFixed(4)}`;
export function duration(run: RunView, now?: number) {
  const end = active(run.state) ? (now ?? Date.parse(run.updatedAt)) : Date.parse(run.updatedAt);
  const ms = run.result?.durationMs ?? end - Date.parse(run.createdAt);
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}
