import { DraftPathSchema, DraftTextSchema } from "@nanogent/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DraftFileActions } from "@/components/draft-file-actions";
import { SessionConversation } from "@/components/session-conversation";
import { SessionFileEditor } from "@/components/session-file-editor";
import { parentPath, repositoryPath } from "@/lib/projects";
import { pageUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/guard";
import { authorizedProject, projectConfig, sessionSource } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { withBackend } from "@/lib/server/runtime";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const user = await pageUser();
  const { id, sessionId } = await params;
  const config = projectConfig();
  if (!config || !z.uuid().safeParse(id).success || !z.uuid().safeParse(sessionId).success)
    notFound();
  const session = await withProjectStore((store) => store.session(user.id, id, sessionId));
  if (!session) notFound();
  const { file } = await searchParams;
  const path = repositoryPath.safeParse(file ?? "");
  if (!path.success) notFound();
  try {
    const { repo, client } = await authorizedProject(user.id, id, config);
    const runs = await withBackend((backend) => backend.list(user.id, id, sessionId));
    if (file !== undefined) {
      const [source, draft] = await Promise.all([
        sessionSource(client, repo.full_name, session.commitSha, path.data),
        withProjectStore((store) => store.draft(user.id, id, sessionId)),
      ]);
      if (!draft) notFound();
      const sessionHref = `/projects/${id}/sessions/${sessionId}`;
      const endpoint = `/api${sessionHref}/draft`;
      const href = (value: string) => `${sessionHref}?${new URLSearchParams({ file: value })}`;
      const parent = parentPath(path.data);
      const saved = draft.files.find(({ path }) => path === file);
      if (!source && !saved) notFound();
      const basePaths = new Set(source?.entries?.map(({ path }) => path));
      const entries = source?.entries
        ? [
            ...source.entries,
            ...draft.files
              .filter(
                ({ path, text }) =>
                  text !== null && parentPath(path) === file && !basePaths.has(path),
              )
              .map(({ path }) => ({
                path,
                name: path.slice(path.lastIndexOf("/") + 1),
                type: "file",
              })),
          ]
        : null;
      const text = saved ? saved.text : (source?.text ?? null);
      const editable =
        !repo.private &&
        DraftPathSchema.safeParse(path.data).success &&
        text !== null &&
        DraftTextSchema.safeParse(text).success;
      return (
        <SessionConversation
          session={session}
          repo={repo.full_name}
          canRun={!repo.private}
          initial={runs}
        >
          {path.data && (
            <Link href={href(parent)} prefetch={false} className="text-sm text-link">
              Back to folder
            </Link>
          )}
          {entries ? (
            <>
              {!repo.private && (
                <DraftFileActions
                  key={file}
                  endpoint={endpoint}
                  href={sessionHref}
                  path={path.data}
                  version={draft.version}
                  kind="folder"
                />
              )}
              <ul className="divide-y divide-border rounded border" aria-label="Session files">
                {entries
                  .toSorted(
                    (a, b) =>
                      Number(b.type === "dir") - Number(a.type === "dir") ||
                      a.name.localeCompare(b.name),
                  )
                  .map((entry) => {
                    const edited = draft.files.find(({ path }) => path === entry.path);
                    return (
                      <li key={entry.path}>
                        <Link
                          href={href(entry.path)}
                          prefetch={false}
                          className="block break-all px-4 py-2 hover:bg-accent"
                        >
                          {entry.type === "dir" ? `${entry.name}/` : entry.name}
                          {edited && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {edited.text === null
                                ? "Deleted"
                                : basePaths.has(entry.path)
                                  ? "Edited"
                                  : "Added"}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </>
          ) : saved?.text === null ? (
            <>
              <p className="text-sm text-muted-foreground">{file} is deleted in this draft.</p>
              {!repo.private && (
                <DraftFileActions
                  endpoint={endpoint}
                  href={sessionHref}
                  path={path.data}
                  version={draft.version}
                  kind="deleted"
                />
              )}
            </>
          ) : editable ? (
            <SessionFileEditor
              key={`${sessionId}:${file}`}
              endpoint={endpoint}
              href={sessionHref}
              path={path.data}
              initial={text}
              version={draft.version}
            />
          ) : text !== null ? (
            <pre className="overflow-auto rounded border p-4 text-xs">{text}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">Preview unavailable for this file.</p>
          )}
        </SessionConversation>
      );
    }
    return (
      <SessionConversation
        session={session}
        repo={repo.full_name}
        canRun={!repo.private}
        initial={runs}
      />
    );
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return (
      <section className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-8">
        <h1 className="text-xl font-medium">Session unavailable</h1>
        <p role="alert">{error.message}</p>
      </section>
    );
  }
}
