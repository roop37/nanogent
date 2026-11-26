import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const shots = process.argv.includes("--shots");
const label = shots ? "screenshots" : "smoke";

// Only local test configuration reaches the child process.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TEMP",
      "TMP",
      "SystemRoot",
      "PLAYWRIGHT_BROWSERS_PATH",
      "CI",
    ].includes(name),
  ),
);

if (!existsSync(chromium.executablePath())) {
  console.log(
    `SKIP web ${label}: Playwright Chromium is not installed. Run pnpm --filter @nanogent/web exec playwright install chromium.`,
  );
  process.exit(0);
}
try {
  const browser = await chromium.launch({ env });
  await browser.close();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  if (
    process.platform === "darwin" &&
    message.includes("bootstrap_check_in") &&
    message.includes("Permission denied")
  ) {
    console.log(
      `SKIP web ${label}: the macOS sandbox denies Chromium's Mach-port registration. Run this command in a browser-capable environment.`,
    );
    process.exit(0);
  }
  throw error;
}
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", ...(shots ? ["--config", "playwright.shots.config.ts"] : [])],
  { stdio: "inherit", env },
);
process.exit(result.status ?? 1);
