import { RunsList } from "@/components/runs-list";
import { pageUser } from "@/lib/server/auth";
export default async function Page() {
  await pageUser();
  return <RunsList />;
}
