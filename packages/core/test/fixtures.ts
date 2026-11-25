import { RunSpecSchema } from "../src/index.js";

export const runId = "run_00m0000000_0123456789abcdef01234567";
export const spec = RunSpecSchema.parse({
  id: runId,
  repo: { localPath: "/tmp/fixture" },
  task: "Fix the fixture",
  model: "claude-opus-5-5",
  effort: "high",
});
export const usage = { input: 10, output: 4, cacheRead: 2, cacheWrite: 3, costUsd: 0.001 };
export const verify = { command: "pnpm test", exitCode: 0, output: "Tests passed" };
export const result = {
  status: "completed" as const,
  summary: "Fixed the fixture",
  diff: "+fixed",
  verify,
  verified: true,
  usage,
  turns: 1,
  toolCalls: 2,
  durationMs: 500,
};
