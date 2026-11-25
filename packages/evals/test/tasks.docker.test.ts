import { fileURLToPath } from "node:url";
import { DockerSandboxProvider, docker } from "@nanogent/sandbox";
import { expect, it } from "vitest";
import { checkTasks, loadTasks, verifyHidden } from "../src/index.js";

const available = await docker(["info", "--format", "{{.ServerVersion}}"], { timeoutSec: 5 })
  .then((r) => r.exitCode === 0)
  .catch(() => false);
const TASKS = fileURLToPath(new URL("../../../evals/tasks", import.meta.url));

it.skipIf(!available)(
  "every bundled task fails as shipped and passes with its solution",
  async () => {
    const provider = new DockerSandboxProvider();
    const tasks = await loadTasks(TASKS);
    const checks = await checkTasks(
      tasks,
      (task, change) => verifyHidden(task, change, provider),
      3,
    );
    const broken = checks.filter((c) => !c.baselineFails || !c.solutionPasses);
    expect(broken).toEqual([]);
  },
);
