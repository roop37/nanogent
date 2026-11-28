import { type TokenUsage, TokenUsageSchema } from "@nanogent/core";
import { z } from "zod";

export const ModelSchema = z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
export type Model = z.infer<typeof ModelSchema>;
export const DEFAULT_MODEL: Model = "claude-haiku-5-5";
export const PRODUCTION_MODEL: Model = "claude-sonnet-5-5";

// USD per 1M tokens; verify against Anthropic pricing before changing.
export const MODEL_PRICING = Object.freeze({
  "claude-opus-5-5": Object.freeze({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }),
  "claude-sonnet-5-5": Object.freeze({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }),
  "claude-haiku-5-5": Object.freeze({
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  }),
}) satisfies Readonly<Record<Model, Readonly<TokenUsage>>>;

export function costUsd(model: string, usage: TokenUsage): number {
  const parsedModel = ModelSchema.safeParse(model);
  if (!parsedModel.success) throw new Error("Unknown model for pricing");
  // Explicit projection accepts Usage (which additionally contains costUsd).
  const tokens = TokenUsageSchema.parse({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  });
  const price = MODEL_PRICING[parsedModel.data];
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    1_000_000
  );
}
