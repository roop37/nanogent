import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { EffortSchema } from "@nanogent/core";
import { z } from "zod";
import { ModelSchema } from "./pricing.js";

export const ConfigSchema = z.strictObject({
  apiKey: z.string().trim().min(1).optional(),
  environment: z.enum(["development", "test", "production"]),
  model: ModelSchema,
  effort: EffortSchema,
  refusalFallback: z.boolean(),
  home: z.string().trim().min(1).default("~/.nanogent"),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Read only the designated runtime variables; never load files or log the config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NANOGENT_ENV === "production";
  const fallback = z.enum(["on", "off"]).optional().safeParse(env.NANOGENT_REFUSAL_FALLBACK);
  if (!fallback.success) throw new Error("Invalid Nanogent config fields: refusalFallback");
  const parsed = ConfigSchema.safeParse({
    environment: env.NANOGENT_ENV ?? "development",
    refusalFallback: fallback.data === undefined ? production : fallback.data === "on",
    apiKey: env.NANOGENT_ANTHROPIC_API_KEY,
    model: env.NANOGENT_MODEL ?? (production ? "claude-opus-5-5" : "claude-haiku-5-5"),
    effort: env.NANOGENT_EFFORT ?? (production ? "high" : "medium"),
    home: env.NANOGENT_HOME,
  });
  if (!parsed.success) {
    // Zod errors can contain submitted values. Expose field names only, never the raw error.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid Nanogent config fields: ${fields.join(", ")}`);
  }
  const config = parsed.data;
  const home = config.home;
  if (home === "~") config.home = homedir();
  else if (home.startsWith("~/")) config.home = join(homedir(), home.slice(2));
  else config.home = isAbsolute(home) ? home : resolve(home);
  return config;
}

/** The Claude brain calls this on startup; loading config itself needs no credentials. */
export function requireAnthropicApiKey(config: Pick<Config, "apiKey">): string {
  const key = config.apiKey?.trim();
  if (!key) throw new Error("NANOGENT_ANTHROPIC_API_KEY is required to start the Claude brain");
  return key;
}
