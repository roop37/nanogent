"use client";
import type { RunEvent } from "@nanogent/core";
import Link from "next/link";
import { useEffect, useState } from "react";
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
    let disposed = false;
    let from = 1;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function get(path: string) {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        throw new Error("Sign in to continue.");
      }
      if (response.status === 404) throw new Error("Run not found.");
      if (!response.ok) throw new Error("Connection interrupted. Retrying shortly.");
      return response.json();
    }
    async function poll() {
      let delay = 1500;
      try {
        const { run: latest }: { run: RunView } = await get(`/api/runs/${id}`);
        const page: EventPage = await get(`/api/runs/${id}/events?from=${from}`);
        if (disposed) return;
        setRun(latest);
        setError("");
        setClock(Date.now());
        setEvents((prior) => {
          const seen = new Set(prior.map((e) => e.seq));
          return [...prior, ...page.events.filter((e) => !seen.has(e.seq))];
        });
        from = page.nextSeq;
        if (page.hasMore) delay = 0;
        else if (!active(latest.state)) return;
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Could not refresh run.");
        delay = 3000;
      }
      if (!disposed) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id]);
  return (
    <>
      <Link href="/" className="text-sm text-slate-600 hover:text-indigo-700">
        All runs
      </Link>
      <div className="mb-7 mt-5 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-3">
            <Status state={run.state} />
            <span className="text-sm text-slate-500">
              {active(run.state) ? "Updates automatically" : "Run finished"}
            </span>
          </div>
          <h1 className="break-words text-2xl font-semibold leading-snug tracking-tight">
            {run.spec.task}
          </h1>
          <p className="mt-2 break-all text-sm text-slate-500">
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
        <output className="mb-4 block rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Run saved, but its start could not be confirmed. It begins when the runner picks it up, or
          you can cancel it. Its budget remains reserved.
        </output>
      )}
      {(error || cancelError) && (
        <p role="alert" className="mb-4 text-red-700">
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
          <div key={label} className="rounded-lg border bg-white p-5">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-2 font-mono text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      {run.result && (
        <section className="mb-8 rounded-xl border bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Result</h2>
            <span
              className={`rounded-md px-3 py-1 text-sm font-medium ${run.result.verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {run.result.verified
                ? "Verified: pass"
                : run.result.verify
                  ? "Verified: fail"
                  : "Unverified"}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-slate-700">
            {run.result.summary || "No summary recorded."}
          </p>
          {run.result.failureReason && (
            <p className="mt-3 text-red-700">{run.result.failureReason}</p>
          )}
          {run.result.verify && (
            <details className="mt-5" open>
              <summary className="text-sm font-medium">
                Verify output · {run.result.verify.command}
              </summary>
              <pre className="mt-3 rounded-md bg-slate-950 p-4 text-slate-100">
                {run.result.verify.output || "No output."}
              </pre>
            </details>
          )}
        </section>
      )}
      {!active(run.state) && !run.result && (
        <p className="mb-6 rounded-lg border bg-white p-5 text-slate-600">
          This run ended without a result. No verification or diff was recorded.
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
          <h2 className="border-b px-5 py-4 text-lg font-semibold">Event timeline</h2>
          <Timeline events={events} />
        </section>
        <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
          <h2 className="border-b px-5 py-4 text-lg font-semibold">Changes</h2>
          {run.result ? (
            <Diff diff={run.result.diff} />
          ) : (
            <p className="p-5 text-slate-500">The diff will appear when the run finishes.</p>
          )}
        </section>
      </div>
    </>
  );
}
