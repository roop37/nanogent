import type { RunEvent } from "@nanogent/core";
import { money } from "@/lib/types";

function Content({ event }: { event: RunEvent }) {
  switch (event.type) {
    case "tool.call":
      return (
        <>
          <p className="font-medium">{event.data.name}</p>
          <pre className="mt-1 text-muted-foreground">
            {JSON.stringify(event.data.input).slice(0, 240)}
          </pre>
        </>
      );
    case "tool.result":
      return (
        <details>
          <summary className="text-sm font-medium">
            Tool result · {event.data.isError ? "error" : "done"} · {event.data.durationMs}ms
          </summary>
          <pre className="mt-3 rounded-md bg-panel p-3">{event.data.output}</pre>
          {event.data.truncated && (
            <p className="mt-1 text-sm text-muted-foreground">Output truncated by the run limit.</p>
          )}
        </details>
      );
    case "model.response":
      return (
        <>
          <p className="font-medium">
            Model response{" "}
            <span className="ml-2 font-mono text-sm text-link">
              {money(event.data.usage.costUsd)}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.data.model} · {event.data.usage.input} input / {event.data.usage.output} output
            tokens
          </p>
        </>
      );
    case "run.created":
      return <p>Run created</p>;
    case "run.state_changed":
      return (
        <p>
          State: {event.data.to.replaceAll("_", " ")}
          {event.data.reason && (
            <span className="text-muted-foreground"> · {event.data.reason}</span>
          )}
        </p>
      );
    case "sandbox.ready":
      return <p>Sandbox ready</p>;
    case "verify.result":
      return <p>Verification {event.data.exitCode === 0 ? "passed" : "failed"}</p>;
    case "run.result":
      return <p>Result saved</p>;
    case "log":
      return (
        <p className={event.data.level === "error" ? "text-destructive" : "text-muted-foreground"}>
          {event.data.message}
        </p>
      );
    case "budget.exceeded":
      return <p className="text-destructive">Limit reached: {event.data.reason}</p>;
    case "approval.requested":
      return (
        <p>
          Approval requested for {event.data.name}. Approval is not available in this dashboard;
          cancel the run if needed.
        </p>
      );
    case "approval.resolved":
      return <p>Approval: {event.data.decision}</p>;
  }
}
export function Timeline({ events }: { events: RunEvent[] }) {
  return events.length ? (
    <ol className="divide-y">
      {events.map((event) => (
        <li key={event.seq} className="flex gap-4 px-5 py-4">
          <span className="w-9 shrink-0 pt-1 font-mono text-xs text-muted-foreground">
            #{event.seq}
          </span>
          <div className="min-w-0 flex-1">
            <Content event={event} />
            <time className="mt-2 block text-xs text-muted-foreground" dateTime={event.ts}>
              {new Date(event.ts).toISOString().slice(11, 19)} UTC
            </time>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="p-5 text-muted-foreground">Loading events…</p>
  );
}
