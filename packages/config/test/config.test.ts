import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, requireAnthropicApiKey } from "../src/index.js";

afterEach(() => vi.unstubAllEnvs());

describe("config", () => {
  it("loads defaults without credentials", () => {
    expect(loadConfig({})).toEqual({
      environment: "development",
      refusalFallback: false,
      model: "claude-haiku-5-5",
      effort: "medium",
      home: join(homedir(), ".nanogent"),
    });
    expect(() => requireAnthropicApiKey(loadConfig({}))).toThrow(
      "NANOGENT_ANTHROPIC_API_KEY is required",
    );
  });
  it("reads only the designated runtime key", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "unrelated-test-value" }).apiKey).toBeUndefined();
    vi.stubEnv("NANOGENT_ANTHROPIC_API_KEY", "synthetic-test-value");
    vi.stubEnv("NANOGENT_MODEL", "claude-sonnet-5-5");
    vi.stubEnv("NANOGENT_EFFORT", "medium");
    vi.stubEnv("NANOGENT_HOME", "/tmp/nanogent-config-test");
    const config = loadConfig();
    expect(requireAnthropicApiKey(config)).toBe("synthetic-test-value");
    expect(config.model).toBe("claude-sonnet-5-5");
  });
  it.each(["low", "medium", "high", "xhigh", "max"])("accepts effort %s", (effort) => {
    expect(loadConfig({ NANOGENT_EFFORT: effort }).effort).toBe(effort);
  });
  it.each([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
  ])("accepts model %s", (model) => {
    expect(loadConfig({ NANOGENT_MODEL: model }).model).toBe(model);
  });
  it.each([
    ["~", homedir()],
    ["~/custom", join(homedir(), "custom")],
    ["./custom", resolve("custom")],
    ["/tmp/custom", "/tmp/custom"],
  ])("resolves home %s", (input, expected) => {
    expect(loadConfig({ NANOGENT_HOME: input }).home).toBe(expected);
  });
  it.each([
    { NANOGENT_MODEL: "unknown" },
    { NANOGENT_EFFORT: "extreme" },
    { NANOGENT_ANTHROPIC_API_KEY: " " },
    { NANOGENT_HOME: "" },
  ])("rejects malformed configuration", (env) => {
    expect(() => loadConfig(env)).toThrow("Invalid Nanogent config fields");
  });
  it("does not include submitted values or a raw cause in errors", () => {
    try {
      loadConfig({
        NANOGENT_MODEL: "sensitive-test-marker",
        NANOGENT_ANTHROPIC_API_KEY: "private-test-marker",
      });
      expect.fail("Expected invalid model error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("test-marker");
      expect(error).not.toHaveProperty("cause");
    }
  });
  it("requires a nonblank runtime credential", () => {
    expect(() => requireAnthropicApiKey({ apiKey: " " })).toThrow();
    expect(requireAnthropicApiKey({ apiKey: " synthetic-value " })).toBe("synthetic-value");
  });
});

it.each([
  "development",
  "test",
  "production",
])("environment defaults and overrides: %s", (environment) => {
  const production = environment === "production";
  const base = { NANOGENT_ENV: environment };
  expect(loadConfig(base)).toMatchObject({
    environment,
    model: production ? "claude-sonnet-5-5" : "claude-haiku-5-5",
    effort: production ? "high" : "medium",
    refusalFallback: production,
  });
  for (const fallback of ["on", "off"]) {
    for (const model of ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]) {
      for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
        expect(
          loadConfig({
            ...base,
            NANOGENT_MODEL: model,
            NANOGENT_EFFORT: effort,
            NANOGENT_REFUSAL_FALLBACK: fallback,
          }),
        ).toMatchObject({ model, effort, refusalFallback: fallback === "on" });
      }
    }
  }
});
it("rejects invalid environment and fallback switches", () => {
  expect(() => loadConfig({ NANOGENT_ENV: "staging" })).toThrow("environment");
  expect(() => loadConfig({ NANOGENT_REFUSAL_FALLBACK: "true" })).toThrow("refusalFallback");
});
