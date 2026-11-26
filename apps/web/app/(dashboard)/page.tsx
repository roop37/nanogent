import { RunsList } from "@/components/runs-list";
import { pageUser } from "@/lib/server/auth";
import { withBackend } from "@/lib/server/runtime";
export default async function Page() {
  const user = await pageUser();
  const runs = await withBackend((backend) => backend.list(user.id));
  return <RunsList initial={runs} />;
}
