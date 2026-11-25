import { describe, expect, it } from "vitest";
import { createRunId, createRunIdGenerator, RunIdSchema, redact } from "../src/index.js";

describe("run IDs", () => {
  it("makes unique sortable IDs with a frozen or backward-moving clock", () => {
    let time = 1_000;
    const next = createRunIdGenerator(() => time);
    const ids = Array.from({ length: 1000 }, next);
    time = 100;
    ids.push(next());
    time = 10_000;
    ids.push(next());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => RunIdSchema.safeParse(id).success)).toBe(true);
    expect(RunIdSchema.parse(createRunId())).toMatch(/^run_/);
  });
  it("adds entropy across independent generators", () => {
    expect(createRunIdGenerator(() => 1)()).not.toBe(createRunIdGenerator(() => 1)());
  });
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    36 ** 10,
  ])("rejects invalid timestamp %s", (time) => {
    expect(() => createRunIdGenerator(() => time)()).toThrow();
  });
});

describe("redaction (synthetic strings only)", () => {
  it.each([
    ["key=sk-ant-test_123-abc", "key=[REDACTED]"],
    ["key=sk-test_123-abc", "key=[REDACTED]"],
    ["token ghp_test123", "token [REDACTED]"],
    ["Authorization: Bearer test.jwt.token", "Authorization: Bearer [REDACTED]"],
    ["bearer\tFAKE+/token==", "bearer [REDACTED]"],
    ['{"key":"sk-test123"}', '{"key":"[REDACTED]"}'],
    ["ordinary text and task-name", "ordinary text and task-name"],
    ["", ""],
  ])("redacts %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
    expect(redact(redact(input))).toBe(expected);
  });
  it("redacts every occurrence across lines and repeated calls", () => {
    const input = "sk-ant-test1 sk-test2\nghp_test3 Bearer fake-token";
    const expected = "[REDACTED] [REDACTED]\n[REDACTED] Bearer [REDACTED]";
    expect(redact(input)).toBe(expected);
    expect(redact(input)).toBe(expected);
  });
});
