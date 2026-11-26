import { beforeEach, expect, it, vi } from "vitest";
import { getSession, pageUser } from "../lib/server/auth";
import { requireUser } from "../lib/server/guard";
import { settings, testMode } from "../lib/server/settings";

const sdk = vi.hoisted(() => ({
  getSession: vi.fn(),
  cookie: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@neon/auth/next/server", () => ({
  createNeonAuth: () => ({ getSession: sdk.getSession }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: sdk.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: sdk.redirect }));
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("extracts only a valid UUID user from a server session", () => {
  expect(() => requireUser(null)).toThrow("Sign in");
  expect(() => requireUser({ user: { id: "spoofed" } })).toThrow("Sign in");
  expect(requireUser({ user: { id: "00000000-0000-4000-8000-000000000001" } }).id).toBeTruthy();
});
it("uses the SDK data envelope and fails closed on an auth error", async () => {
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.invalid/auth");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "unit-test-placeholder-not-a-secret-0000");
  sdk.getSession.mockResolvedValue({
    data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
    error: null,
  });
  expect((await pageUser()).id).toBeTruthy();
  sdk.getSession.mockResolvedValue({ data: null, error: { message: "invalid" } });
  expect(await getSession()).toBeNull();
  await expect(pageUser()).rejects.toThrow("redirect:/sign-in");
});
it("cannot enable the test bypass in production or Vercel", () => {
  expect(testMode({})).toBe(false);
  expect(
    testMode({ NANOGENT_WEB_TEST_MODE: "1", NODE_ENV: "development", NANOGENT_ENV: "test" }),
  ).toBe(true);
  for (const env of [
    { NODE_ENV: "production", NANOGENT_ENV: "test" },
    { NODE_ENV: "development", NANOGENT_ENV: "production" },
    { NODE_ENV: "development", NANOGENT_ENV: "test", VERCEL: "1" },
  ])
    expect(() => testMode({ ...env, NANOGENT_WEB_TEST_MODE: "1" })).toThrow("only available");
});
it("rejects invalid budget settings without echoing values", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "bad-value"])
    expect(() => settings({ NANOGENT_DAILY_CAP_USD: value })).toThrow(
      "Invalid web budget configuration",
    );
});
