import { MODEL_PRICING } from "@nanogent/config";
import { notFound } from "next/navigation";
import { z } from "zod";
import { NewRun } from "@/components/new-run";
import type { ProjectSession } from "@/lib/projects";
import { pageUser } from "@/lib/server/auth";
import { projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { settings } from "@/lib/server/settings";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; session?: string }>;
}) {
  const user = await pageUser();
  const { project, session: sessionId } = await searchParams;
  const projects = await Promise.resolve()
    .then(() => (projectConfig() ? withProjectStore((store) => store.list(user.id)) : []))
    .catch((error: unknown) => {
      if (project) throw error;
      return [];
    });
  if (project !== undefined && !projects.some(({ id }) => id === project)) notFound();
  let session: ProjectSession | undefined;
  if (sessionId !== undefined) {
    if (!project || !z.uuid().safeParse(sessionId).success) notFound();
    session = await withProjectStore((store) => store.session(user.id, project, sessionId));
    if (!session) notFound();
  }
  const config = settings();
  const models = config.models.map((id) => {
    const { input, output } = MODEL_PRICING[id];
    return { id, input, output };
  });
  const initialProjectId = project ?? projects[0]?.id ?? "";
  return (
    <NewRun
      key={session?.id ?? initialProjectId}
      {...config}
      models={models}
      initialProjectId={initialProjectId}
      {...(session && { session })}
      projects={projects.map(({ id, fullName, branch }) => ({ id, fullName, branch }))}
    />
  );
}
