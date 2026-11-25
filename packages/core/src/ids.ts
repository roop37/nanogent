import { randomBytes } from "node:crypto";
import { z } from "zod";

export const RunIdSchema = z.string().regex(/^run_[0-9a-z]{10}_[0-9a-f]{24}$/);
export type RunId = z.infer<typeof RunIdSchema>;

/** Monotonic within this process, including same-millisecond calls and clock rollback. */
export function createRunIdGenerator(clock: () => number = Date.now): () => RunId {
  let lastTime = -1;
  return () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid run ID clock");
    const time = Math.max(now, lastTime + 1);
    if (time >= 36 ** 10) throw new Error("Run ID timestamp exhausted");
    lastTime = time;
    return `run_${time.toString(36).padStart(10, "0")}_${randomBytes(12).toString("hex")}`;
  };
}

export const createRunId = createRunIdGenerator();
