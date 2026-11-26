import { describe, expect, it } from "vitest";
import { signWake, verifyWake } from "../src/index.js";

const secret = "s".repeat(32);
const now = 1_800_000_000_000;

describe("wake signatures", () => {
  it("accepts a fresh, correctly signed body", () => {
    const body = '{"runId":"run_x"}';
    expect(verifyWake(secret, signWake(secret, body, now), body, now)).toBe(true);
  });
  it("rejects a changed body, a wrong secret and malformed headers", () => {
    const header = signWake(secret, "a", now);
    expect(verifyWake(secret, header, "b", now)).toBe(false);
    expect(verifyWake("t".repeat(32), header, "a", now)).toBe(false);
    for (const bad of [
      undefined,
      null,
      "",
      "t=1",
      "v1=abc",
      `${header},extra`,
      header.toUpperCase(),
    ])
      expect(verifyWake(secret, bad, "a", now)).toBe(false);
  });
  it("only accepts timestamps within a minute", () => {
    const header = signWake(secret, "a", now);
    expect(verifyWake(secret, header, "a", now + 60_000)).toBe(true);
    expect(verifyWake(secret, header, "a", now + 61_000)).toBe(false);
    expect(verifyWake(secret, header, "a", now - 61_000)).toBe(false);
  });
});
