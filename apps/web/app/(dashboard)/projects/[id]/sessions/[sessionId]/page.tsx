import { notFound } from "next/navigation";
import { z } from "zod";
import { SessionConversation } from "@/components/session-conversation";
import { pageUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { withBackend } from "@/lib/server/runtime";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const user = await pageUser();
  const { id, sessionId } = await params;
  const config = projectConfig();
  if (!config || !z.uuid().safeParse(id).success || !z.uuid().safeParse(sessionId).success)
    notFound();
  const session = await withProjectStore((store) => store.session(user.id, id, sessionId));
  if (!session) notFound();
  try {
    const { repo } = await authorizedProject(user.id, id, config);
    const runs = await withBackend((backend) => backend.list(user.id, id, sessionId));
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
