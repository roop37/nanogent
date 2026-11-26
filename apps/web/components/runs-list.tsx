"use client";
import { ArrowUpRight, Plus, Terminal } from "lucide-react";
import Link from "next/link";
import { duration, money } from "@/lib/types";
import { relativeTime, repoName } from "@/lib/workspace";
import { useRuns } from "./shell";
import { Status } from "./status";
import { Button } from "./ui/button";
import { Kbd } from "./ui/primitives";
export function RunsList() {
  const { runs, clock, connected } = useRuns();
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">WORKSPACE</p>
          <h1 className="text-2xl font-medium tracking-tight">Recent runs</h1>
          <p className="mt-2 text-muted-foreground">
            Every task, from first command to verified change.
          </p>
        </div>
        <Button asChild>
          <Link href="/runs/new">
            <Plus />
            New run<Kbd>N</Kbd>
          </Link>
        </Button>
      </div>
      {!connected && (
        <output className="mb-4 text-warning">Could not refresh runs. Retrying shortly.</output>
      )}
      {runs.length === 0 ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
          <Terminal size={40} className="mb-6 text-muted-foreground" />
          <h2 className="text-xl font-medium">Start with a task</h2>
          <p className="mt-3 max-w-sm text-muted-foreground">
            Nanogent works on a repository and checks the change with your tests. Follow the work
            here, then review the result and diff.
          </p>
          <Button asChild className="mt-6">
            <Link href="/runs/new">
              <Plus />
              New run
            </Link>
          </Button>
          <p className="mt-5 text-xs text-muted-foreground">
            Press <Kbd>N</Kbd> to start, or <Kbd>⌘ / Ctrl K</Kbd> to find a run
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-y text-muted-foreground">
              <tr>
                {["State", "Task", "Repository", "Started", "Duration", "Cost"].map((label) => (
                  <th key={label} className="px-3 py-3 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.spec.id} className="border-b hover:bg-accent">
                  <td className="px-3 py-4">
                    <Status state={run.state} verified={run.result?.verified} />
                  </td>
                  <td className="max-w-[320px] min-w-[180px] px-3 py-4">
                    <Link className="group flex items-center gap-3" href={`/runs/${run.spec.id}`}>
                      <span className="truncate text-[13px]">{run.spec.task.split("\n")[0]}</span>
                      <ArrowUpRight
                        size={13}
                        className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                      />
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 text-muted-foreground">{repoName(run)}</td>
                  <td className="whitespace-nowrap px-3 text-muted-foreground">
                    <time dateTime={run.createdAt}>{relativeTime(run.createdAt, clock)}</time>
                  </td>
                  <td className="px-3 font-mono">{duration(run, clock)}</td>
                  <td className="px-3 font-mono">{money(run.progress.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-muted-foreground">
            {runs.length >= 100 ? "Showing the latest 100 runs" : `${runs.length} runs`}
            <span className="ml-3">All times relative to now</span>
          </p>
        </div>
      )}
    </div>
  );
}
