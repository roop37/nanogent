import { FileText, Folder } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProjectBranches } from "@/components/project-branches";
import { Status } from "@/components/status";
import { Button } from "@/components/ui/button";
import { repositoryPath } from "@/lib/projects";
import { pageUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/guard";
import { projectConfig, projectConnection } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { withBackend } from "@/lib/server/runtime";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const user = await pageUser();
  const { id } = await params;
  const config = projectConfig();
  const path = repositoryPath.safeParse((await searchParams).path ?? "");
  if (!config || !path.success || !z.uuid().safeParse(id).success) notFound();
  const project = await withProjectStore((store) => store.get(user.id, id));
  if (!project) notFound();
  const base = `/projects/${id}`;
  const href = (value: string) =>
    value ? `${base}?${new URLSearchParams({ path: value })}` : base;
  const parts = path.data ? path.data.split("/") : [];
  try {
    const { client } = await projectConnection(user.id, config);
    const [repo] = await client.authorizedRepos(project.installationId, [project.repositoryId]);
    if (!repo) notFound();
    const [{ entries, text }, sessions] = await Promise.all([
      client.content(repo.full_name, project.commitSha, path.data),
      parts.length === 0 ? withBackend((backend) => backend.list(user.id, project.id)) : [],
    ]);
    return (
      <section className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="break-words text-xl font-medium">{repo.full_name}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground" title={project.commitSha}>
              {project.branch} · {project.commitSha.slice(0, 8)}
            </p>
          </div>
          {repo.private ? (
            <p className="text-xs text-muted-foreground">Private repository · file browsing only</p>
          ) : (
            <Button asChild>
              <Link href={`/runs/new?project=${project.id}`}>New session</Link>
            </Button>
          )}
        </div>
        {parts.length === 0 && (
          <ProjectBranches
            key={`${id}:${project.branch}:${project.commitSha}`}
            id={id}
            pin={{ branch: project.branch, commitSha: project.commitSha }}
          />
        )}
        {parts.length === 0 && (
          <section className="space-y-2" aria-label="Project sessions">
            <h2 className="font-medium">Sessions</h2>
            {sessions.length ? (
              <ul className="divide-y divide-border rounded border">
                {sessions.map(({ spec, state }) => (
                  <li key={spec.id}>
                    <Link
                      href={`/runs/${spec.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-accent"
                    >
                      <span className="truncate">{spec.task.split("\n")[0]}</span>
                      <Status state={state} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            )}
          </section>
        )}
        <nav aria-label="File path" className="flex flex-wrap gap-2 text-link">
          <Link prefetch={false} href={base}>
            Files
          </Link>
          {parts.map((part, index) => {
            const parent = parts.slice(0, index + 1).join("/");
            return (
              <span key={parent}>
                /{" "}
                <Link prefetch={false} href={href(parent)}>
                  {part}
                </Link>
              </span>
            );
          })}
        </nav>
        {entries ? (
          <ul className="divide-y divide-border rounded border">
            {entries.length ? (
              entries
                .toSorted(
                  (a, b) =>
                    Number(b.type === "dir") - Number(a.type === "dir") ||
                    a.name.localeCompare(b.name),
                )
                .map((entry) => (
                  <li key={entry.path}>
                    <Link
                      prefetch={false}
                      href={href(entry.path)}
                      className="flex items-center gap-3 break-all px-4 py-2 hover:bg-accent"
                    >
                      {entry.type === "dir" ? (
                        <Folder size={16} className="shrink-0" />
                      ) : (
                        <FileText size={16} className="shrink-0" />
                      )}
                      {entry.name}
                    </Link>
                  </li>
                ))
            ) : (
              <li className="p-4 text-muted-foreground">This directory is empty.</li>
            )}
          </ul>
        ) : text === null ? (
          <p>Preview is only available for UTF-8 text files up to 128 KiB.</p>
        ) : (
          <section aria-label="File contents">
            <pre className="overflow-auto rounded border bg-panel p-4 font-mono text-xs">
              <code>{text}</code>
            </pre>
          </section>
        )}
      </section>
    );
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return (
      <section className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-8">
        <h1 className="text-xl font-medium">Project unavailable</h1>
        <p role="alert">{error.message}</p>
        <Link className="text-link underline" href="/projects">
          Back to projects
        </Link>
      </section>
    );
  }
}
