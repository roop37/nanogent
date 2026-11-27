import { Shell } from "@/components/shell";
import { pageUser } from "@/lib/server/auth";
import { withBackend } from "@/lib/server/runtime";
import { settings } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  const config = settings();
  const data = await withBackend(async (backend) => ({
    runs: await backend.list(user.id),
    allowance: await backend.allowance(user.id),
  })).catch(() => null);
  return (
    <Shell
      user={user}
      initial={data?.runs ?? []}
      initialAllowance={data?.allowance ?? null}
      initialConnected={!!data}
      initialTime={Date.now()}
      config={config}
    >
      {children}
    </Shell>
  );
}
