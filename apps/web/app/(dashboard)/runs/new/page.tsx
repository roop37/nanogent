import { MODEL_PRICING } from "@nanogent/config";
import { NewRun } from "@/components/new-run";
import { pageUser } from "@/lib/server/auth";
import { settings } from "@/lib/server/settings";
export default async function Page() {
  await pageUser();
  const config = settings();
  const models = config.models.map((id) => {
    const { input, output } = MODEL_PRICING[id];
    return { id, input, output };
  });
  return <NewRun {...config} models={models} />;
}
