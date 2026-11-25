import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  DEFAULT_POLICY,
  EffortSchema,
  ExecResultSchema,
  LimitsSchema,
  PermissionPolicySchema,
  permissionFor,
  RepoSchema,
  RunResultSchema,
  RunSpecSchema,
  UsageSchema,
} from "../src/index.js";
import { result, spec, usage } from "./fixtures.js";

describe("run schemas", () => {
  it("validates nonblank text without rewriting task, path or command contents", () => {
    const task = "  Keep this task formatting\n";
    const command = "cat <<'EOF'\nvalue\nEOF\n";
    const parsed = RunSpecSchema.parse({
      ...spec,
      task,
      repo: { localPath: "/tmp/repo with trailing space " },
      setupCommands: [command],
      verifyCommand: command,
    });
    expect(parsed.task).toBe(task);
    expect(parsed.repo).toEqual({ localPath: "/tmp/repo with trailing space " });
    expect(parsed.setupCommands).toEqual([command]);
    expect(parsed.verifyCommand).toBe(command);
  });
  it("fills independent defaults", () => {
    const input = { ...spec, limits: undefined, policy: undefined, setupCommands: undefined };
    const first = RunSpecSchema.parse(input);
    const second = RunSpecSchema.parse(input);
    expect(first.limits).toEqual(DEFAULT_LIMITS);
    expect(first.policy).toEqual(DEFAULT_POLICY);
    expect(first.setupCommands).toEqual([]);
    first.policy.risks.external = "allow";
    first.limits.maxTurns = 1;
    expect(second.policy.risks.external).toBe("deny");
    expect(second.limits.maxTurns).toBe(60);
  });
  it.each([
    { url: "https://example.com/repo.git", ref: "abc123" },
    { localPath: "./fixtures" },
  ])("accepts a repository source: %j", (repo) => {
    expect(RepoSchema.parse(repo)).toEqual(repo);
  });
  it.each([
    {},
    { url: "invalid" },
    { localPath: " " },
    { localPath: "/tmp", url: "https://example.com/repo" },
    { localPath: "/tmp", ref: "" },
  ])("rejects ambiguous/invalid repository: %j", (repo) => {
    expect(RepoSchema.safeParse(repo).success).toBe(false);
  });
  it.each([
    { id: "../../escape" },
    { task: " " },
    { model: "" },
    { effort: "extreme" },
    { setupCommands: [""] },
    { verifyCommand: "" },
    { apiKey: "forbidden" },
    { limits: { ...DEFAULT_LIMITS, extra: 1 } },
  ])("rejects malformed run fields: %j", (override) => {
    expect(RunSpecSchema.safeParse({ ...spec, ...override }).success).toBe(false);
  });
  it.each(
    Object.keys(DEFAULT_LIMITS) as (keyof typeof DEFAULT_LIMITS)[],
  )("rejects nonpositive and nonfinite %s", (key) => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(LimitsSchema.safeParse({ ...DEFAULT_LIMITS, [key]: invalid }).success).toBe(false);
    }
  });
  it("rejects fractional counters but permits fractional costs and durations", () => {
    expect(LimitsSchema.safeParse({ ...DEFAULT_LIMITS, maxTurns: 1.5 }).success).toBe(false);
    expect(LimitsSchema.parse({ ...DEFAULT_LIMITS, maxCostUsd: 0.01 }).maxCostUsd).toBe(0.01);
    expect(UsageSchema.safeParse({ ...usage, input: 1.5 }).success).toBe(false);
    expect(UsageSchema.safeParse({ ...usage, costUsd: -1 }).success).toBe(false);
  });
  it.each(["low", "medium", "high", "xhigh", "max"])("accepts effort %s", (effort) => {
    expect(EffortSchema.parse(effort)).toBe(effort);
  });
  it("requires verified success and a reason for failure", () => {
    expect(RunResultSchema.parse(result)).toEqual(result);
    for (const verify of [
      null,
      { ...result.verify, exitCode: 1 },
      { ...result.verify, exitCode: null },
    ]) {
      expect(RunResultSchema.safeParse({ ...result, verify }).success).toBe(false);
    }
    expect(RunResultSchema.safeParse({ ...result, status: "failed" }).success).toBe(false);
    expect(RunResultSchema.safeParse({ ...result, status: "running" }).success).toBe(false);
    expect(
      RunResultSchema.parse({
        ...result,
        status: "failed",
        verified: false,
        verify: null,
        failureReason: "budget",
      }).status,
    ).toBe("failed");
    expect(
      RunResultSchema.parse({ ...result, status: "canceled", verified: false, verify: null })
        .status,
    ).toBe("canceled");
  });
  it("represents a process terminated without an exit status", () => {
    const execution = { exitCode: null, stdout: "", stderr: "", timedOut: true, truncated: false };
    expect(ExecResultSchema.parse(execution)).toEqual(execution);
    expect(ExecResultSchema.safeParse({ ...execution, timedOut: "yes" }).success).toBe(false);
  });
});

describe("permission policy", () => {
  it("defaults external and network actions to deny", () => {
    expect(permissionFor(DEFAULT_POLICY, { name: "push", risk: "external" })).toBe("deny");
    expect(permissionFor(DEFAULT_POLICY, { name: "fetch", risk: "network" })).toBe("deny");
    expect(permissionFor(DEFAULT_POLICY, { name: "view", risk: "read" })).toBe("allow");
  });
  it("uses explicit tool override, then risk, then default", () => {
    const policy = PermissionPolicySchema.parse({
      default: "deny",
      tools: { bash: "deny" },
      risks: { exec: "ask" },
    });
    expect(permissionFor(policy, { name: "bash", risk: "exec" })).toBe("deny");
    expect(permissionFor(policy, { name: "test", risk: "exec" })).toBe("ask");
    expect(permissionFor(policy, { name: "view", risk: "read" })).toBe("deny");
    expect(permissionFor(policy, { name: "toString", risk: "read" })).toBe("deny");
  });
  it.each([
    { default: "yes", tools: {}, risks: {} },
    { default: "deny", tools: {}, risks: { unknown: "allow" } },
    { default: "deny", tools: { bash: "yes" }, risks: {} },
  ])("rejects malformed policies: %j", (policy) => {
    expect(PermissionPolicySchema.safeParse(policy).success).toBe(false);
  });
});
