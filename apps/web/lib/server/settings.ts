import "server-only";
import { DEFAULT_MODEL, ModelSchema, PRODUCTION_MODEL } from "@nanogent/config";
import { z } from "zod";
export function settings(env: Record<string, string | undefined> = process.env) {
  const cap = z.coerce
    .number()
    .finite()
    .positive()
    .safeParse(env.NANOGENT_DAILY_CAP_USD ?? 1);
  const max = z.coerce
    .number()
    .finite()
    .positive()
    .safeParse(env.NANOGENT_MAX_RUN_COST_USD ?? 1);
  if (!cap.success || !max.success) throw new Error("Invalid web budget configuration");
  const production = env.NANOGENT_ENV === "production";
  const fallbackModel = production ? PRODUCTION_MODEL : DEFAULT_MODEL;
  const configured = env.NANOGENT_WEB_MODELS?.split(",").map((id) => id.trim());
  const parsed = z
    .array(ModelSchema)
    .nonempty()
    .safeParse(configured ?? [fallbackModel]);
  if (!parsed.success) throw new Error("Invalid web model configuration");
  const models = [...new Set(parsed.data)];
  return {
    environment: production ? "prod" : "dev",
    dailyCap: cap.data,
    maxCost: Math.min(max.data, cap.data),
    defaultModel: parsed.data[0] ?? fallbackModel,
    models,
  };
}
export function testMode(env: Record<string, string | undefined> = process.env) {
  if (env.NANOGENT_WEB_TEST_MODE !== "1") return false;
  if (env.NODE_ENV !== "development" || env.NANOGENT_ENV !== "test" || env.VERCEL) {
    throw new Error("Web test mode is only available in local development with NANOGENT_ENV=test");
  }
  return true;
}
