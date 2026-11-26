"use client";
import type { RunEvent } from "@nanogent/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { visiblePolling } from "@/lib/polling";
import { active, duration, type EventPage, money, type RunView } from "@/lib/types";
import { Diff } from "./diff";
import { Status } from "./status";
import { Timeline } from "./timeline";
import { Button } from "./ui/button";
export function LiveRun({
  initial,
  dispatchPending,
}: {
  initial: RunView;
  dispatchPending: boolean;
}) {
  const [run, setRun] = useState(initial);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<number>();
  const [cancelError, setCancelError] = useState("");
  const [canceling, setCanceling] = useState(false);
  const id = initial.spec.id;
  useEffect(() => {
    let from = 1;
    async function get(path: string, signal: AbortSignal) {
      const response = await fetch(path, { cache: "no-store", signal });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        throw new Error("Sign in to continue.");
      }
      if (response.status === 404) throw new Error("Run not found.");
      if (!response.ok) throw new Error("Connection interrupted. Retrying shortly.");
      return response.json();
    }
    return visiblePolling(
      async (signal) => {
        const { run: latest }: { run: RunView } = await get(`/api/runs/${id}`, signal);
        const page: EventPage = await get(`/api/runs/${id}/events?from=${from}`, signal);
        if (signal.aborted) return null;
        setRun(latest);
        setError("");
        setClock(Date.now());
        setEvents((prior) => {
          const seen = new Set(prior.map((e) => e.seq));
          return [...prior, ...page.events.filter((e) => !seen.has(e.seq))];
        });
        from = page.nextSeq;
        return page.hasMore ? 0 : active(latest.state) ? 1500 : null;
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : "Could not refresh run.");
        return 3000;
      },
    );
  }, [id]);
  return (
    <>
      <Link href="/" className="text-sm text-muted-foreground hover:text-link">
        All runs
      </Link>
      <div className="mb-7 mt-5 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-3">
            <Status state={run.state} />
            <span className="text-sm text-muted-foreground">
              {active(run.state) ? "Updates automatically" : "Run finished"}
            </span>
          </div>
          <h1 className="break-words text-2xl font-semibold leading-snug tracking-tight">
            {run.spec.task}
          </h1>
          <p className="mt-2 break-all text-sm text-muted-foreground">
            {"url" in run.spec.repo ? run.spec.repo.url : "Local repository"}
          </p>
        </div>
        {active(run.state) && (
          <Button
            variant="outline"
            disabled={canceling || run.cancelRequested}
            onClick={async () => {
              setCanceling(true);
              setCancelError("");
              try {
                const response = await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
                if (!response.ok) throw new Error();
                setRun((prior) => ({ ...prior, cancelRequested: true }));
              } catch {
                setCancelError("Could not confirm cancellation. Try again.");
              }
              setCanceling(false);
            }}
          >
            {run.cancelRequested
              ? "Cancellation requested"
              : canceling
                ? "Canceling…"
                : "Cancel run"}
          </Button>
        )}
      </div>
      {dispatchPending && run.state === "queued" && (
        <output className="mb-4 block rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Run saved, but its start could not be confirmed. It begins when the runner picks it up, or
          you can cancel it. Its budget remains reserved.
        </output>
      )}
      {(error || cancelError) && (
        <p role="alert" className="mb-4 text-destructive">
          {error || cancelError}
        </p>
      )}
      <dl className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Turns", run.progress.turns],
          ["Tool calls", run.progress.toolCalls],
          ["Cost so far", money(run.progress.costUsd)],
          ["Duration", duration(run, clock)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border bg-background p-5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 font-mono text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      {run.result && (
        <section className="mb-8 rounded-md border bg-background p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Result</h2>
            <span
              className={`rounded-md px-3 py-1 text-sm font-medium ${run.result.verified ? "bg-added text-foreground" : "bg-warning/10 text-warning"}`}
            >
              {run.result.verified
                ? "Verified: pass"
                : run.result.verify
                  ? "Verified: fail"
                  : "Unverified"}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-foreground">
            {run.result.summary || "No summary recorded."}
          </p>
          {run.result.failureReason && (
            <p className="mt-3 text-destructive">{run.result.failureReason}</p>
          )}
          {run.result.verify && (
            <details className="mt-5" open>
              <summary className="text-sm font-medium">
                Verify output · {run.result.verify.command}
              </summary>
              <pre className="mt-3 rounded-md bg-panel p-4 text-foreground">
                {run.result.verify.output || "No output."}
              </pre>
            </details>
          )}
        </section>
      )}
      {!active(run.state) && !run.result && (
        <p className="mb-6 rounded-md border bg-background p-5 text-muted-foreground">
          This run ended without a result. No verification or diff was recorded.
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-md border bg-background">
          <h2 className="border-b px-5 py-4 text-lg font-semibold">Event timeline</h2>
          <Timeline events={events} />
        </section>
        <section className="min-w-0 overflow-hidden rounded-md border bg-background">
          <h2 className="border-b px-5 py-4 text-lg font-semibold">Changes</h2>
          {run.result ? (
            <Diff diff={run.result.diff} />
          ) : (
            <p className="p-5 text-muted-foreground">The diff will appear when the run finishes.</p>
          )}
        </section>
      </div>
    </>
  );
}
