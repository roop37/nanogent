import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

export const EvalTaskSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  category: z.enum(["bug", "multi-file", "debugging", "refactor", "environment"]),
  instruction: z.string().min(1),
  verify: z.string().min(1),
  setup: z.array(z.string().min(1)).default([]),
});

export type EvalTask = z.infer<typeof EvalTaskSchema> & {
  /** Code the agent sees. */
  repoDir: string;
  /** Tests copied in only for grading. */
  hiddenDir: string;
  /** Reference solution, copied over the repo by `checkTasks`. Optional. */
  solutionDir?: string;
};

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function loadTask(dir: string): Promise<EvalTask> {
  const raw = JSON.parse(await readFile(join(dir, "task.json"), "utf8"));
  const parsed = EvalTaskSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${dir}/task.json: ${z.prettifyError(parsed.error)}`);
  const task = parsed.data;
  const repoDir = join(dir, "repo");
  const hiddenDir = join(dir, "hidden");
  if (!(await exists(repoDir))) throw new Error(`${task.id}: missing repo/`);
  if (!(await exists(hiddenDir))) throw new Error(`${task.id}: missing hidden/`);
  const solutionDir = join(dir, "solution");
  return { ...task, repoDir, hiddenDir, ...((await exists(solutionDir)) && { solutionDir }) };
}

export async function loadTasks(root: string, only?: readonly string[]): Promise<EvalTask[]> {
  const base = resolve(root);
  const entries = await readdir(base, { withFileTypes: true });
  const tasks: EvalTask[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (only && only.length > 0 && !only.includes(entry.name)) continue;
    const task = await loadTask(join(base, entry.name));
    if (task.id !== entry.name) throw new Error(`${entry.name}: id in task.json is ${task.id}`);
    tasks.push(task);
  }
  const missing = (only ?? []).filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) throw new Error(`Unknown task: ${missing.join(", ")}`);
  return tasks;
}
