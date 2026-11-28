import type { RunEvent, RunRecord } from "@nanogent/core";
export interface RunView extends RunRecord {
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  progress: { turns: number; toolCalls: number; costUsd: number };
  diffSnapshot?: string;
}
export interface EventPage {
  events: RunEvent[];
  nextSeq: number;
  hasMore: boolean;
}
export const active = (state: string) => ["queued", "running", "awaiting_approval"].includes(state);
export const money = (cost: number) => `$${cost.toFixed(4)}`;
export function duration(run: RunView, now?: number) {
  if (run.state === "queued") return "—";
  const end = active(run.state) ? (now ?? Date.parse(run.updatedAt)) : Date.parse(run.updatedAt);
  const ms = run.result?.durationMs ?? end - Date.parse(run.createdAt);
  return formatDuration(ms);
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function commandDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")}s`;
  return formatDuration(ms);
}
export function modelName(id: string) {
  const match = /^claude-(haiku|sonnet|opus)-(\d+)-(\d+)$/.exec(id);
  return match
    ? `${match[1]?.[0]?.toUpperCase()}${match[1]?.slice(1)} ${match[2]}.${match[3]}`
    : id;
}
