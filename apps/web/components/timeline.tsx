"use client";
import type { RunEvent } from "@nanogent/core";
import { Check, CircleX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupTimeline, inputText, type Step, toolInput } from "@/lib/timeline";
import { formatDuration, money } from "@/lib/types";
import { type Notify, TerminalBlock } from "./terminal-block";
import { Skeleton } from "./ui/primitives";

function Content({ step, running, notify }: { step: Step; running: boolean; notify: Notify }) {
  const event = step.event;
  if (step.logs) {
    const policy = step.logs.filter(
      (e) => e.type === "log" && /policy|permission/i.test(e.data.message),
    ).length;
    return (
      <details className="text-muted-foreground">
        <summary>
          {policy === step.logs.length
            ? `${policy} policy checks`
            : `${step.logs.length} log lines`}
        </summary>
        {step.logs.map(
          (e) =>
            e.type === "log" && (
              <pre key={e.seq} className={e.data.level === "error" ? "text-destructive" : ""}>
                {e.data.message}
              </pre>
            ),
        )}
      </details>
    );
  }
  switch (event.type) {
    case "tool.call": {
      const input = toolInput(event);
      const operation = inputText(input, "command");
      const path = inputText(input, "path");
      const summary = inputText(input, "summary");
      const inline =
        operation === "str_replace"
          ? `${inputText(input, "old_str")
              .split("\n")
              .map((l) => `− ${l}`)
              .join("\n")}\n${inputText(input, "new_str")
              .split("\n")
              .map((l) => `+ ${l}`)
              .join("\n")}`
          : operation === "create" || operation === "insert"
            ? (inputText(input, "file_text") || inputText(input, "new_str"))
                .split("\n")
                .map((l) => `+ ${l}`)
                .join("\n")
            : "";
      return (
        <div className={event.data.name === "submit" ? "submit-block" : ""}>
          {event.data.name === "submit" && <p className="mb-2 font-medium">Final summary</p>}
          <TerminalBlock
            command={
              event.data.name === "bash"
                ? `$ ${operation}`
                : event.data.name === "submit"
                  ? "submit"
                  : `${operation || event.data.name} ${path}`
            }
            text={[summary, inline, step.result?.data.output].filter(Boolean).join("\n")}
            running={running && !step.result}
            error={step.result?.data.isError}
            truncated={step.result?.data.truncated}
            notify={notify}
          />
          {step.result && (
            <p className="mt-1 text-xs text-muted-foreground">
              {step.result.data.isError ? "Command failed" : "Done"} ·{" "}
              {formatDuration(step.result.data.durationMs)}
            </p>
          )}
        </div>
      );
    }
    case "tool.result":
      return (
        <TerminalBlock
          text={event.data.output}
          error={event.data.isError}
          truncated={event.data.truncated}
          notify={notify}
        />
      );
    case "model.response":
      return (
        <div className="turn-heading">
          <span>Turn {step.turn}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {money(event.data.usage.costUsd)} · {money(step.cumulative ?? 0)} total
          </span>
        </div>
      );
    case "run.created":
      return <p className="text-muted-foreground">Run created</p>;
    case "sandbox.ready":
      return <p className="text-muted-foreground">Sandbox ready</p>;
    case "run.state_changed":
      return (
        <p
          className={
            ["failed", "canceled"].includes(event.data.to)
              ? "reason-block"
              : "text-muted-foreground"
          }
        >
          {event.data.to === "canceled"
            ? "Run canceled"
            : event.data.to === "failed"
              ? "Run failed"
              : event.data.to.replaceAll("_", " ")}
          {event.data.reason ? ` · ${event.data.reason}` : ""}
        </p>
      );
    case "verify.result":
      return (
        <div className={`verification-result ${event.data.exitCode === 0 ? "passed" : "failed"}`}>
          <p className="flex items-center gap-2 font-medium">
            {event.data.exitCode === 0 ? <Check size={16} /> : <CircleX size={16} />}
            {event.data.exitCode === 0 ? "Verified" : "Verification failed"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {event.data.exitCode === null
              ? "Timed out or interrupted"
              : `Exit ${event.data.exitCode}`}{" "}
            ·{" "}
            {event.data.durationMs === undefined
              ? "Duration not recorded"
              : formatDuration(event.data.durationMs)}
          </p>
        </div>
      );
    case "run.result":
      return event.data.failureReason ? (
        <p className="reason-block">{event.data.failureReason}</p>
      ) : event.data.summary ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{event.data.summary}</p>
      ) : null;
    case "budget.exceeded":
      return (
        <p className="reason-block">
          Run stopped:{" "}
          {(
            {
              maxCostUsd: "cost limit",
              maxTurns: "turn limit",
              maxToolCalls: "tool call limit",
              maxWallTimeSec: "time limit",
            } as Record<string, string>
          )[event.data.reason] ?? event.data.reason}{" "}
          reached ({event.data.actual} / {event.data.limit}).
        </p>
      );
    case "approval.requested":
      return (
        <p className="reason-block">
          Waiting for approval to use {event.data.name}. Approval is not available here; you can
          cancel this run.
        </p>
      );
    case "approval.resolved":
      return <p>Permission {event.data.decision === "allow" ? "granted" : "denied"}.</p>;
    case "log":
      return null;
  }
}
export function Timeline({
  events,
  started,
  running,
  loaded,
  notify,
}: {
  events: RunEvent[];
  started: string;
  running: boolean;
  loaded: boolean;
  notify: Notify;
}) {
  const steps = useMemo(() => groupTimeline(events), [events]);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [behind, setBehind] = useState(false);
  const latest = events.at(-1)?.seq;
  // A new event can update an existing command block without adding a row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sequence triggers following after layout
  useEffect(() => {
    const node = viewport.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
    else if (node) setBehind(true);
  }, [latest]);
  return (
    <section className="activity-pane" aria-label="Activity">
      <h2 className="pane-title">
        Activity{" "}
        <span className="text-muted-foreground font-normal">{running ? "Live" : "Session"}</span>
      </h2>
      <div
        ref={viewport}
        className="timeline-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (follow.current) setBehind(false);
        }}
      >
        {!loaded ? (
          <section className="space-y-5 p-4" aria-label="Loading activity">
            <Skeleton />
            <Skeleton className="h-24" />
            <Skeleton className="w-2/3" />
          </section>
        ) : steps.length ? (
          <ol className="timeline">
            {steps.map((step) => (
              <li key={step.seq} className="timeline-step">
                <time className="timestamp" dateTime={step.event.ts}>
                  {formatDuration(Date.parse(step.event.ts) - Date.parse(started))}
                </time>
                <div className="min-w-0">
                  <Content step={step} running={running} notify={notify} />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-4 text-muted-foreground">No activity recorded yet.</p>
        )}
        {running && loaded && (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            Waiting for the next event <span className="terminal-cursor">▍</span>
          </p>
        )}
      </div>
      {behind && (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            const el = viewport.current;
            if (el) el.scrollTop = el.scrollHeight;
            follow.current = true;
            setBehind(false);
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </section>
  );
}
