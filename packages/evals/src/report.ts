import type { Attempt } from "./runner.js";

export interface Rate {
  attempts: number;
  passed: number;
  rate: number;
}

export interface Summary {
  model: string;
  effort: string;
  startedAt: string;
  attempts: number;
  passed: number;
  successRate: number;
  byDifficulty: Record<string, Rate>;
  byCategory: Record<string, Rate>;
  totalCostUsd: number;
  /** Hidden-test passes per US dollar spent. */
  passedPerDollar: number | null;
  medianCostPerPass: number | null;
  medianDurationMs: number | null;
  visibleButNotHidden: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function rates(attempts: readonly Attempt[], key: "difficulty" | "category"): Record<string, Rate> {
  const out: Record<string, Rate> = {};
  for (const attempt of attempts) {
    const name = attempt[key];
    const bucket = out[name] ?? { attempts: 0, passed: 0, rate: 0 };
    out[name] = bucket;
    bucket.attempts++;
    if (attempt.passed) bucket.passed++;
  }
  for (const bucket of Object.values(out)) bucket.rate = bucket.passed / bucket.attempts;
  return out;
}

export function summarize(
  attempts: readonly Attempt[],
  meta: { model: string; effort: string; startedAt: string },
): Summary {
  const passed = attempts.filter((a) => a.passed);
  const totalCostUsd = attempts.reduce((sum, a) => sum + a.costUsd, 0);
  return {
    ...meta,
    attempts: attempts.length,
    passed: passed.length,
    successRate: attempts.length ? passed.length / attempts.length : 0,
    byDifficulty: rates(attempts, "difficulty"),
    byCategory: rates(attempts, "category"),
    totalCostUsd,
    passedPerDollar: totalCostUsd > 0 ? passed.length / totalCostUsd : null,
    medianCostPerPass: median(passed.map((a) => a.costUsd)),
    medianDurationMs: median(attempts.map((a) => a.durationMs)),
    visibleButNotHidden: attempts.filter((a) => a.visiblePass && !a.passed).length,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const usd = (n: number | null) => (n === null ? "-" : `$${n.toFixed(4)}`);

export function toMarkdown(summary: Summary, attempts: readonly Attempt[]): string {
  const lines = [
    `# Eval: ${summary.model} (${summary.effort})`,
    "",
    `Started ${summary.startedAt}. ${summary.passed}/${summary.attempts} passed (${pct(summary.successRate)}).`,
    "",
    "| | |",
    "| --- | --- |",
    `| Total cost | ${usd(summary.totalCostUsd)} |`,
    `| Passes per dollar | ${summary.passedPerDollar === null ? "-" : summary.passedPerDollar.toFixed(1)} |`,
    `| Median cost per pass | ${usd(summary.medianCostPerPass)} |`,
    `| Median duration | ${summary.medianDurationMs === null ? "-" : `${(summary.medianDurationMs / 1000).toFixed(1)} s`} |`,
    `| Passed visible tests but failed hidden ones | ${summary.visibleButNotHidden} |`,
    "",
    "| Difficulty | Passed | Rate |",
    "| --- | --- | --- |",
    ...Object.entries(summary.byDifficulty).map(
      ([k, r]) => `| ${k} | ${r.passed}/${r.attempts} | ${pct(r.rate)} |`,
    ),
    "",
    "| Category | Passed | Rate |",
    "| --- | --- | --- |",
    ...Object.entries(summary.byCategory).map(
      ([k, r]) => `| ${k} | ${r.passed}/${r.attempts} | ${pct(r.rate)} |`,
    ),
    "",
    "| Task | # | Result | Cost | Time | Turns | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...attempts.map(
      (a) =>
        `| ${a.taskId} | ${a.attempt} | ${a.passed ? "pass" : "fail"} | ${usd(a.costUsd)} | ${(a.durationMs / 1000).toFixed(1)} s | ${a.turns} | ${(a.gradingError ?? a.failureReason ?? "").replaceAll("|", "/").slice(0, 80)} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
