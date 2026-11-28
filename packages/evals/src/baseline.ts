import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RunEvalOptions } from "./runner.js";
import type { EvalTask } from "./task.js";

async function treeDigest(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(dir, entry.name);
    if (!entry.isDirectory() && !entry.isFile()) throw new Error("Unsupported eval fixture entry");
    const digest = entry.isDirectory()
      ? await treeDigest(path)
      : createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    hash.update(JSON.stringify([entry.name, entry.isDirectory(), digest]));
  }
  return hash.digest("hex");
}

const protocolSchema = z.strictObject({
  model: z.string().min(1),
  maxCostUsd: z.number().positive(),
  repeat: z.int().positive(),
  suiteDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function evalProtocol(
  tasks: readonly EvalTask[],
  options: Omit<z.infer<typeof protocolSchema>, "suiteDigest">,
) {
  if (!tasks.length) throw new Error("No eval tasks selected");
  const hash = createHash("sha256");
  for (const task of tasks) {
    hash.update(
      JSON.stringify([
        task.id,
        task.instruction,
        task.setup,
        task.verify,
        await treeDigest(task.repoDir),
        await treeDigest(task.hiddenDir),
      ]),
    );
  }
  return protocolSchema.parse({ ...options, suiteDigest: hash.digest("hex") });
}

const attemptSchema = z.object({
  taskId: z.string(),
  attempt: z.int().positive(),
  passed: z.boolean(),
  costUsd: z.number().nonnegative(),
});
const savedReport = z.object({ protocol: protocolSchema, attempts: z.array(attemptSchema) });
const trajectory = z.object({
  trajectory_format: z.literal("mini-swe-agent-1.1"),
  info: z.object({
    mini_version: z.string().regex(/^[\w.-]+$/),
    exit_status: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    submission: z.string(),
    model_stats: z.object({ instance_cost: z.number().nonnegative() }),
    config: z.object({
      model: z.object({ model_name: z.string() }),
      agent: z.object({ cost_limit: z.number().positive() }),
    }),
  }),
});

async function readJson(path: string): Promise<unknown> {
  const maxBytes = 16 * 1024 * 1024;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("Invalid eval input file size");
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size) throw new Error("Eval input changed while reading");
    try {
      return JSON.parse(buffer.toString("utf8", 0, bytesRead));
    } catch {
      throw new Error("Invalid JSON in eval input");
    }
  } finally {
    await file.close();
  }
}

export async function compareReference(options: {
  tasks: readonly EvalTask[];
  protocol: z.infer<typeof protocolSchema>;
  reportPath: string;
  referenceDir: string;
  grade: RunEvalOptions["grade"];
}) {
  const { tasks, protocol, reportPath, referenceDir, grade } = options;
  const report = savedReport.safeParse(await readJson(reportPath));
  if (!report.success) throw new Error("Invalid Nanogent eval report or missing eval protocol");
  if (
    Object.keys(protocol).some((key) => {
      const field = key as keyof typeof protocol;
      return protocol[field] !== report.data.protocol[field];
    })
  )
    throw new Error("Nanogent report does not match the tasks, model, budget and repetitions");

  const key = (id: string, attempt: number) => `${id}.${attempt}`;
  const saved = new Map(report.data.attempts.map((a) => [key(a.taskId, a.attempt), a]));
  if (saved.size !== report.data.attempts.length || saved.size !== tasks.length * protocol.repeat)
    throw new Error("Nanogent report has missing or duplicate attempts");

  const cases = [];
  const versions = new Set<string>();
  for (const task of tasks) {
    for (let attempt = 1; attempt <= protocol.repeat; attempt++) {
      const id = key(task.id, attempt);
      const nanogent = saved.get(id);
      if (!nanogent) throw new Error(`Missing Nanogent attempt ${id}`);
      const parsed = trajectory.safeParse(await readJson(join(referenceDir, `${id}.traj.json`)));
      if (!parsed.success) throw new Error(`Invalid mini-SWE-agent trajectory for ${id}`);
      const { info } = parsed.data;
      if (
        info.config.model.model_name.replace(/^anthropic\//, "") !== protocol.model ||
        info.config.agent.cost_limit !== protocol.maxCostUsd
      )
        throw new Error(`mini-SWE-agent model or budget mismatch for ${id}`);
      versions.add(info.mini_version);
      cases.push({ task, nanogent, info });
    }
  }
  if (versions.size !== 1) throw new Error("Use the same mini-SWE-agent version for every attempt");
  const rows: {
    taskId: string;
    attempt: number;
    nanogent: { passed: boolean; costUsd: number };
    reference: { passed: boolean; costUsd: number; status: string };
  }[] = [];
  for (const { task, nanogent, info } of cases) {
    const result =
      info.exit_status === "Submitted" && info.submission.trim()
        ? await grade(task, { patch: info.submission })
        : null;
    rows.push({
      taskId: task.id,
      attempt: nanogent.attempt,
      nanogent: { passed: nanogent.passed, costUsd: nanogent.costUsd },
      reference: {
        passed: result?.passed ?? false,
        costUsd: info.model_stats.instance_cost,
        status: info.exit_status,
      },
    });
  }
  function score(harness: "nanogent" | "reference") {
    const passed = rows.filter((row) => row[harness].passed).length;
    const costUsd = rows.reduce((sum, row) => sum + row[harness].costUsd, 0);
    return {
      passed,
      attempts: rows.length,
      successRate: passed / rows.length,
      costUsd,
      costPerPass: passed ? costUsd / passed : null,
    };
  }
  return {
    protocol,
    miniSweAgentVersion: [...versions][0],
    nanogent: score("nanogent"),
    miniSweAgent: score("reference"),
    rows,
  };
}
