import Anthropic from "@anthropic-ai/sdk";
import { ClaudeBrain } from "@nanogent/brain";
import { loadConfig, requireAnthropicApiKey } from "@nanogent/config";
import { type EventSink, MIN_WAKE_SECRET_LENGTH } from "@nanogent/core";
import {
  DaytonaSandboxProvider,
  DockerSandboxProvider,
  isTransientDaytonaError,
} from "@nanogent/sandbox";
import { connectPostgres, PostgresRunStore } from "@nanogent/store";
import { executeStoredRun } from "./execute.js";
import { startRunner } from "./runner.js";
import { createWakeServer } from "./wake-server.js";

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function main(): Promise<void> {
  const databaseUrl = process.env.NANOGENT_DATABASE_URL;
  if (!databaseUrl) throw new Error("NANOGENT_DATABASE_URL is required");
  const wakeSecret = process.env.NANOGENT_WAKE_SECRET ?? "";
  if (wakeSecret.length < MIN_WAKE_SECRET_LENGTH)
    throw new Error(`NANOGENT_WAKE_SECRET must be at least ${MIN_WAKE_SECRET_LENGTH} characters`);
  const config = loadConfig();
  const apiKey = requireAnthropicApiKey(config);
  const sandboxKind = process.env.NANOGENT_SANDBOX ?? "docker";
  if (sandboxKind !== "docker" && sandboxKind !== "daytona")
    throw new Error("NANOGENT_SANDBOX must be docker or daytona");
  const daytonaKey = process.env.DAYTONA_API_KEY;
  if (sandboxKind === "daytona" && !daytonaKey)
    throw new Error("DAYTONA_API_KEY is required when NANOGENT_SANDBOX=daytona");

  const { db, pool } = connectPostgres(databaseUrl);
  const store = new PostgresRunStore(db, [
    apiKey,
    databaseUrl,
    wakeSecret,
    ...(daytonaKey ? [daytonaKey] : []),
  ]);
  const brain = new ClaudeBrain(new Anthropic({ apiKey, maxRetries: 0 }).beta.messages);
  const provider =
    sandboxKind === "docker"
      ? new DockerSandboxProvider()
      : (events: EventSink) =>
          new DaytonaSandboxProvider({
            apiKey: daytonaKey as string,
            environment: config.environment,
            events,
          });

  const runner = startRunner({
    store,
    concurrency: number("NANOGENT_CONCURRENCY", 2),
    sweepMs: number("NANOGENT_SWEEP_SEC", 900) * 1000,
    drainMs: number("NANOGENT_DRAIN_SEC", 300) * 1000,
    log,
    execute: (runId, signal) =>
      executeStoredRun(runId, {
        store,
        brain,
        signal,
        provider,
        ...(sandboxKind === "daytona" && { retryableSetup: isTransientDaytonaError }),
      }),
  });
  const server = createWakeServer({ secret: wakeSecret, onWake: runner.wake });
  const port = number("NANOGENT_RUNNER_PORT", 8787);
  server.listen(port, "0.0.0.0", () =>
    log(`runner ready: ${sandboxKind} sandboxes, wake port ${port}`),
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: finishing ${runner.running} running run(s) before exit`);
    server.close();
    await runner.stop();
    await pool.end();
    log("stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
