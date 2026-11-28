import { MODEL_PRICING } from "@nanogent/config";
import { notFound } from "next/navigation";
import { NewRun } from "@/components/new-run";
import { pageUser } from "@/lib/server/auth";
import { projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { settings } from "@/lib/server/settings";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const user = await pageUser();
  const { project } = await searchParams;
  const projects = await Promise.resolve()
    .then(() => (projectConfig() ? withProjectStore((store) => store.list(user.id)) : []))
    .catch((error: unknown) => {
      if (project) throw error;
      return [];
    });
  if (project !== undefined && !projects.some(({ id }) => id === project)) notFound();
  const config = settings();
  const models = config.models.map((id) => {
    const { input, output } = MODEL_PRICING[id];
    return { id, input, output };
  });
  const initialProjectId = project ?? projects[0]?.id ?? "";
  return (
    <NewRun
      key={initialProjectId}
      {...config}
      models={models}
      initialProjectId={initialProjectId}
      projects={projects.map(({ id, fullName, branch }) => ({ id, fullName, branch }))}
    />
  );
}
