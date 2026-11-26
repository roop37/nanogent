import { NewRun } from "@/components/new-run";
import { pageUser } from "@/lib/server/auth";
import { settings } from "@/lib/server/settings";
export default async function Page() {
  await pageUser();
  return <NewRun {...settings()} />;
}
