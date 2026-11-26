import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3199", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3199",
    url: "http://127.0.0.1:3199/sign-in",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: "development",
      NANOGENT_ENV: "test",
      NANOGENT_WEB_TEST_MODE: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      WATCHPACK_POLLING: "true",
      NANOGENT_DAILY_CAP_USD: "1",
      NANOGENT_MAX_RUN_COST_USD: "1",
    },
  },
});
