import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeBrain } from "@nanogent/brain";
import { loadConfig, requireAnthropicApiKey } from "@nanogent/config";
import { RunIdSchema } from "@nanogent/core";
import { DaytonaSandboxProvider, isTransientDaytonaError } from "@nanogent/sandbox";
import { connectPostgres, PostgresRunStore } from "@nanogent/store";
import { metadata, task } from "@trigger.dev/sdk";
import { executeStoredRun } from "../execute.js";

function assetRoot(): string {
  for (const root of [process.cwd(), resolve(process.cwd(), "../..")]) {
    if (existsSync(resolve(root, "prompts/system.md"))) return root;
  }
  throw new Error("Worker assets are missing; build with the configured additionalFiles extension");
}
export const executeRun = task({
  id: "execute-run",
  queue: { concurrencyLimit: 10 },
  retry: { maxAttempts: 1 },
  run: async (payload: { runId: string }, { signal }) => {
    const runId = RunIdSchema.parse(payload.runId);
    const databaseUrl = process.env.NANOGENT_DATABASE_URL;
    const daytonaKey = process.env.DAYTONA_API_KEY;
    if (!databaseUrl || !daytonaKey)
      throw new Error("NANOGENT_DATABASE_URL and DAYTONA_API_KEY are required");
    const config = loadConfig();
    const apiKey = requireAnthropicApiKey(config);
    const { db, pool } = connectPostgres(databaseUrl);
    try {
      const root = assetRoot();
      return await executeStoredRun(runId, {
        store: new PostgresRunStore(db, [apiKey, daytonaKey, databaseUrl]),
        signal,
        brain: new ClaudeBrain(
          new Anthropic({ apiKey, maxRetries: 0 }).beta.messages,
          500,
          readFileSync(resolve(root, "prompts/system.md"), "utf8"),
        ),
        provider: (events) =>
          new DaytonaSandboxProvider({
            apiKey: daytonaKey,
            environment: config.environment,
            events,
            helperDirectory: resolve(root, "packages/sandbox/docker"),
          }),
        retryableSetup: isTransientDaytonaError,
        progress: async (progress) => {
          metadata
            .set("state", progress.state)
            .set("turns", progress.turns)
            .set("costUsd", progress.costUsd);
          await metadata.flush();
        },
      });
    } finally {
      await pool.end();
    }
  },
  onCancel: async ({ runPromise }) => {
    await runPromise;
  },
});
