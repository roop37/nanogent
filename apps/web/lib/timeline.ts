import type { RunEvent } from "@nanogent/core";
export type ToolEvent = Extract<RunEvent, { type: "tool.call" }>;
export type ToolResult = Extract<RunEvent, { type: "tool.result" }>;
export type Step = {
  seq: number;
  event: RunEvent;
  result?: ToolResult;
  logs?: RunEvent[];
  turn?: number;
  cumulative?: number;
};
export function mergeEvents(prior: RunEvent[], incoming: RunEvent[]) {
  return [...new Map([...incoming, ...prior].map((e) => [e.seq, e])).values()].sort(
    (a, b) => a.seq - b.seq,
  );
}
export function groupTimeline(events: RunEvent[]): Step[] {
  const steps: Step[] = [];
  const pending = new Map<string, Step>();
  let turn = 0;
  let cumulative = 0;
  for (const event of mergeEvents([], events)) {
    if (event.type === "tool.result") {
      const call = pending.get(event.data.toolCallId);
      if (call) {
        call.result = event;
        pending.delete(event.data.toolCallId);
        continue;
      }
    }
    if (event.type === "log") {
      const last = steps.at(-1);
      if (last?.logs) {
        last.logs.push(event);
        continue;
      }
      steps.push({ seq: event.seq, event, logs: [event] });
      continue;
    }
    const step: Step = { seq: event.seq, event };
    if (event.type === "model.response") {
      cumulative += event.data.usage.costUsd;
      step.turn = ++turn;
      step.cumulative = cumulative;
    }
    if (event.type === "tool.call") pending.set(event.data.toolCallId, step);
    steps.push(step);
  }
  return steps;
}
export function costLevel(cost: number, limit: number) {
  const ratio = limit > 0 ? cost / limit : cost > 0 ? 1 : 0;
  return {
    percent: Math.min(100, Math.max(0, ratio * 100)),
    tone: ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : "normal",
  } as const;
}
export function toolInput(event: ToolEvent): Record<string, unknown> {
  const input = event.data.input;
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}
export function inputText(input: Record<string, unknown>, key: string) {
  return typeof input[key] === "string" ? (input[key] as string) : "";
}
