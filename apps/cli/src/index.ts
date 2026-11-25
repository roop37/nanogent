import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeBrain, type MessagesClient } from "@nanogent/brain";
import { loadConfig, requireAnthropicApiKey } from "@nanogent/config";
import { LocalController } from "@nanogent/controller";
import {
  createRunId,
  DEFAULT_LIMITS,
  type RunEvent,
  type RunResult,
  RunSpecSchema,
  redact,
  type SandboxProvider,
} from "@nanogent/core";
import { DockerSandboxProvider } from "@nanogent/sandbox";
import { JsonlRunStore } from "@nanogent/store";

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  client?: MessagesClient;
  provider?: SandboxProvider;
  write?: (text: string) => void;
  signal?: AbortSignal;
}
function eventLine(event: RunEvent, cost: number): string {
  const prefix = `${event.seq} ${event.type}`;
  if (event.type === "tool.call")
    return `${prefix} ${event.data.name} ${JSON.stringify(event.data.input).slice(0, 120)} $${cost.toFixed(4)}`;
  if (event.type === "model.response") return `${prefix} ${event.data.model} $${cost.toFixed(4)}`;
  if (event.type === "run.state_changed") return `${prefix} ${event.data.to}`;
  return prefix;
}
function summary(result: RunResult): string {
  return `${result.status}: ${result.summary}\n${result.verified ? "Verified: PASS" : result.verify ? "Verified: FAIL" : "UNVERIFIED: no harness verification"}\n${result.failureReason ?? ""}\n${result.verify?.output ?? ""}\nCost: $${result.usage.costUsd.toFixed(4)}\n${result.diff}\n`;
}
export async function runCli(args: string[], deps: CliDeps = {}): Promise<number> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      task: { type: "string" },
      verify: { type: "string" },
      setup: { type: "string", multiple: true },
      model: { type: "string" },
      effort: { type: "string" },
      fallback: { type: "string" },
      "max-cost": { type: "string" },
      "max-turns": { type: "string" },
      json: { type: "boolean" },
      "max-age": { type: "string" },
      ref: { type: "string" },
    },
  });
  const env = { ...(deps.env ?? process.env) };
  if (parsed.values.model !== undefined) env.NANOGENT_MODEL = parsed.values.model;
  if (parsed.values.effort !== undefined) env.NANOGENT_EFFORT = parsed.values.effort;
  if (parsed.values.fallback !== undefined) env.NANOGENT_REFUSAL_FALLBACK = parsed.values.fallback;
  const config = loadConfig(env);
  const store = new JsonlRunStore(config.home, config.apiKey ? [config.apiKey] : []);
  const [command, id] = parsed.positionals;
  if (command === "list") {
    for (const record of await store.list())
      write(
        parsed.values.json
          ? `${JSON.stringify(record)}\n`
          : `${record.spec.id} ${record.state} ${record.spec.task.replaceAll(/\s+/g, " ").slice(0, 100)}\n`,
      );
    return 0;
  }
  if (command === "show") {
    if (!id) throw new Error("show requires a run ID");
    const record = await store.get(id);
    if (!record) throw new Error("Run not found");
    write(
      parsed.values.json
        ? `${JSON.stringify(record)}\n`
        : record.result
          ? summary(record.result)
          : `${record.state}\n`,
    );
    return 0;
  }
  if (command === "gc") {
    const count = await new DockerSandboxProvider().gc(Number(parsed.values["max-age"] ?? 3600));
    write(
      `${parsed.values.json ? JSON.stringify({ removed: count }) : `Removed ${count} sandboxes`}\n`,
    );
    return 0;
  }
  if (command !== "run" || !parsed.values.repo || !parsed.values.task)
    throw new Error(
      'Usage: nanogent run --repo <url|path> --task "text" [--verify "cmd"] [--setup "cmd"]',
    );
  const repo = /^https?:\/\//.test(parsed.values.repo)
    ? { url: parsed.values.repo }
    : { localPath: parsed.values.repo };
  const spec = RunSpecSchema.parse({
    id: createRunId(),
    repo: { ...repo, ...(parsed.values.ref && { ref: parsed.values.ref }) },
    task: parsed.values.task,
    setupCommands: parsed.values.setup ?? [],
    ...(parsed.values.verify && { verifyCommand: parsed.values.verify }),
    model: config.model,
    effort: config.effort,
    refusalFallback: config.refusalFallback,
    limits: {
      ...DEFAULT_LIMITS,
      ...(parsed.values["max-cost"] && { maxCostUsd: Number(parsed.values["max-cost"]) }),
      ...(parsed.values["max-turns"] && { maxTurns: Number(parsed.values["max-turns"]) }),
    },
  });
  const client =
    deps.client ??
    new Anthropic({ apiKey: requireAnthropicApiKey(config), maxRetries: 2 }).beta.messages;
  const controller = new LocalController(
    store,
    new ClaudeBrain(client),
    deps.provider ?? new DockerSandboxProvider(),
  );
  const runId = await controller.submit(spec);
  let cancelError: unknown;
  const cancel = () => {
    void controller.cancel(runId).catch((error: unknown) => {
      cancelError = error;
    });
  };
  deps.signal?.addEventListener("abort", cancel, { once: true });
  if (deps.signal?.aborted) cancel();
  let cost = 0;
  let result: RunResult | undefined;
  try {
    for await (const event of controller.watch(runId)) {
      if (event.type === "model.response") cost += event.data.usage.costUsd;
      if (event.type === "run.result") result = event.data;
      write(parsed.values.json ? `${JSON.stringify(event)}\n` : `${eventLine(event, cost)}\n`);
    }
  } finally {
    deps.signal?.removeEventListener("abort", cancel);
  }
  if (cancelError) throw cancelError;
  if (!result) throw new Error("Run ended without a result");
  if (!parsed.values.json) write(redact(summary(result)));
  return result.verified ? 0 : 1;
}
