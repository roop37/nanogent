import { DraftPathSchema, DraftTextSchema } from "@nanogent/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SessionConversation } from "@/components/session-conversation";
import { SessionFileEditor } from "@/components/session-file-editor";
import { repositoryPath } from "@/lib/projects";
import { pageUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
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
        client.content(repo.full_name, session.commitSha, path.data),
        withProjectStore((store) => store.draft(user.id, id, sessionId)),
      ]);
      if (!draft) notFound();
      const sessionHref = `/projects/${id}/sessions/${sessionId}`;
      const href = (value: string) => `${sessionHref}?${new URLSearchParams({ file: value })}`;
      const parent = path.data.split("/").slice(0, -1).join("/");
      const saved = draft.files.find(({ path }) => path === file);
      const editable =
        !repo.private &&
        DraftPathSchema.safeParse(path.data).success &&
        source.text !== null &&
        DraftTextSchema.safeParse(source.text).success;
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
          {source.entries ? (
            <ul className="divide-y divide-border rounded border" aria-label="Session files">
              {source.entries
                .toSorted(
                  (a, b) =>
                    Number(b.type === "dir") - Number(a.type === "dir") ||
                    a.name.localeCompare(b.name),
                )
                .map((entry) => (
                  <li key={entry.path}>
                    <Link
                      href={href(entry.path)}
                      prefetch={false}
                      className="block break-all px-4 py-2 hover:bg-accent"
                    >
                      {entry.type === "dir" ? `${entry.name}/` : entry.name}
                      {draft.files.some(({ path }) => path === entry.path) && (
                        <span className="ml-2 text-xs text-muted-foreground">Edited</span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          ) : editable ? (
            <SessionFileEditor
              key={`${sessionId}:${file}`}
              endpoint={`/api${sessionHref}/draft`}
              path={path.data}
              initial={saved?.text ?? source.text ?? ""}
              version={draft.version}
            />
          ) : source.text !== null ? (
            <pre className="overflow-auto rounded border p-4 text-xs">{source.text}</pre>
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
