"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { duration, money, type RunView } from "@/lib/types";
import { Status } from "./status";
import { Button } from "./ui/button";
export function RunsList({ initial }: { initial: RunView[] }) {
  const [runs, setRuns] = useState(initial);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<number>();
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          window.location.assign("/sign-in");
          return;
        }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!disposed) {
          setRuns(data.runs);
          setError("");
          setClock(Date.now());
        }
      } catch {
        if (!disposed) setError("Could not refresh runs. Retrying shortly.");
      }
      if (!disposed) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 5000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your runs</h1>
          <p className="mt-2 text-slate-600">Track a task from first command to final diff.</p>
        </div>
        <Button asChild>
          <Link href="/runs/new">New run</Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-red-700">
          {error}
        </p>
      )}
      {runs.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-16 text-center">
          <h2 className="text-xl font-semibold">No runs yet</h2>
          <p className="mx-auto mt-3 max-w-md text-slate-600">
            Choose a public repository and describe the change. You can watch the work and review
            the result here.
          </p>
          <Button asChild className="mt-6">
            <Link href="/runs/new">Create your first run</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-600">
              <tr>
                {["Task / repository", "Status", "Cost", "Duration", "Created"].map((title) => (
                  <th key={title} className="px-5 py-4 font-medium">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.spec.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="max-w-xs px-5 py-5">
                    <Link
                      className="block truncate text-base font-medium hover:text-indigo-700"
                      href={`/runs/${run.spec.id}`}
                      title={run.spec.task}
                    >
                      {run.spec.task}
                    </Link>
                    <p className="mt-1 truncate text-slate-500">
                      {"url" in run.spec.repo
                        ? run.spec.repo.url.replace("https://", "")
                        : "Local repository"}
                    </p>
                  </td>
                  <td className="px-5 py-5">
                    <Status state={run.state} />
                  </td>
                  <td className="px-5 py-5 font-mono">{money(run.progress.costUsd)}</td>
                  <td className="px-5 py-5">{duration(run, clock)}</td>
                  <td className="whitespace-nowrap px-5 py-5 text-slate-600">
                    <time dateTime={run.createdAt}>
                      {new Date(run.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runs.length >= 100 && (
        <p className="mt-3 text-sm text-slate-500">Showing the latest 100 runs.</p>
      )}
    </>
  );
}
