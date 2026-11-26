import "server-only";
import { DEFAULT_MODEL, ModelSchema } from "@nanogent/config";
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
  return {
    dailyCap: cap.data,
    maxCost: Math.min(max.data, cap.data),
    models: env.NANOGENT_ENV === "production" ? [...ModelSchema.options] : [DEFAULT_MODEL],
  };
}
export function testMode(env: Record<string, string | undefined> = process.env) {
  if (env.NANOGENT_WEB_TEST_MODE !== "1") return false;
  if (env.NODE_ENV !== "development" || env.NANOGENT_ENV !== "test" || env.VERCEL) {
    throw new Error("Web test mode is only available in local development with NANOGENT_ENV=test");
  }
  return true;
}
