import { Shell } from "@/components/shell";
import { pageUser } from "@/lib/server/auth";
import { projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { withBackend } from "@/lib/server/runtime";
import { settings } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  const config = settings();
  const [data, projects] = await Promise.all([
    withBackend(async (backend) => ({
      runs: await backend.list(user.id),
      allowance: await backend.allowance(user.id),
    })).catch(() => null),
    Promise.resolve()
      .then(() =>
        projectConfig()
          ? withProjectStore(async (store) =>
              (await store.list(user.id)).map(({ id, fullName }) => ({ id, fullName })),
            ).catch(() => [])
          : null,
      )
      .catch(() => null),
  ]);
  return (
    <Shell
      user={user}
      initial={data?.runs ?? []}
      initialAllowance={data?.allowance ?? null}
      initialConnected={!!data}
      initialTime={Date.now()}
      projects={projects}
      config={config}
    >
      {children}
    </Shell>
  );
}
