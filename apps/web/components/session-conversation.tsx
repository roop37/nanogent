"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import type { ProjectSession } from "@/lib/projects";
import { active, type RunView } from "@/lib/types";
import { useRuns } from "./shell";
import { Status } from "./status";
import { Button } from "./ui/button";

export function SessionConversation({
  session,
  repo,
  canRun,
  initial,
  children,
}: {
  session: ProjectSession;
  repo: string;
  canRun: boolean;
  initial: RunView[];
  children?: ReactNode;
}) {
  const { runs, openEditor } = useRuns();
  const { id, projectId, name, branch, commitSha } = session;
  const projectHref = `/projects/${projectId}`;
  const sessionHref = `${projectHref}/sessions/${id}`;
  useEffect(() => {
    openEditor({ href: sessionHref, title: name });
  }, [name, openEditor, sessionHref]);
  const byId = new Map(initial.map((run) => [run.spec.id, run]));
  for (const run of runs) {
    if (run.sessionId !== id || run.projectId !== projectId) continue;
    const prior = byId.get(run.spec.id);
    if (!prior || run.updatedAt > prior.updatedAt) byId.set(run.spec.id, run);
  }
  const history = [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.spec.id.localeCompare(b.spec.id),
  );
  const busy = history.some((run) => active(run.state));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <Link href={projectHref} prefetch={false} className="text-sm text-link">
            {repo}
          </Link>
          <h1 className="mt-2 break-words text-xl font-medium">{name}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground" title={commitSha}>
            {branch} · {commitSha.slice(0, 8)}
          </p>
        </div>
        {canRun &&
          (busy ? (
            <Button disabled>Run in progress</Button>
          ) : (
            <Button asChild>
              <Link href={`/runs/new?${new URLSearchParams({ project: projectId, session: id })}`}>
                {history.length ? "Continue session" : "Start session"}
              </Link>
            </Button>
          ))}
      </header>
      <nav
        aria-label="Session views"
        className="flex gap-4 border-b border-border pb-2 text-sm text-link"
      >
        <Link href={sessionHref} prefetch={false} aria-current={children ? undefined : "page"}>
          Conversation
        </Link>
        <Link
          href={`${sessionHref}?file=`}
          prefetch={false}
          aria-current={children ? "page" : undefined}
        >
          Files
        </Link>
      </nav>
      {children ??
        (!history.length ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ol className="space-y-4" aria-label="Session conversation">
            {history.map((run) => (
              <li key={run.spec.id} className="space-y-3 rounded border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">You</span>
                  <Link
                    href={`/runs/${run.spec.id}`}
                    prefetch={false}
                    className="flex items-center gap-2 text-sm text-link"
                  >
                    View run <Status state={run.state} />
                  </Link>
                </div>
                <p className="whitespace-pre-wrap break-words">{run.spec.task}</p>
                {(run.result?.summary || run.result?.failureReason) && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-sm font-medium">Result</p>
                    {run.result.summary && (
                      <p className="whitespace-pre-wrap break-words">{run.result.summary}</p>
                    )}
                    {run.result.failureReason && (
                      <p className="break-words text-destructive">{run.result.failureReason}</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
