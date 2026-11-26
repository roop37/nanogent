import { Check, CircleAlert, CircleX, Minus } from "lucide-react";
import { Spinner } from "./ui/primitives";

const colors: Record<string, string> = {
  queued: "text-neutral",
  running: "text-running",
  awaiting_approval: "text-warning",
  completed: "text-success",
  failed: "text-destructive",
  canceled: "text-neutral",
};
export function StatusDot({ state }: { state: string }) {
  const Icon =
    state === "completed"
      ? Check
      : state === "failed"
        ? CircleX
        : state === "awaiting_approval"
          ? CircleAlert
          : state === "canceled"
            ? Minus
            : null;
  return (
    <span
      className={`inline-flex shrink-0 items-center ${colors[state] ?? "text-neutral"}`}
      aria-hidden="true"
    >
      {state === "running" ? (
        <Spinner />
      ) : Icon ? (
        <Icon size={14} />
      ) : (
        <span className="m-1 size-1.5 rounded-full bg-current" />
      )}
    </span>
  );
}
export function StatusBadge({
  state,
  verified,
}: {
  state: string;
  verified?: boolean | undefined;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <StatusDot state={state} />
      {state === "awaiting_approval"
        ? "blocked"
        : state === "completed" && verified
          ? "verified"
          : state}
    </span>
  );
}
export const Status = StatusBadge;
