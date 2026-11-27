import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { longDiff, verifiedRunPath } from "./run-fixtures";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`screens at ${viewport.width}`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (/same key|unique.*key|hydration/i.test(message.text())) errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await mkdir(".shots", { recursive: true });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
    );
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `.shots/${name}-${viewport.width}x${viewport.height}.png`,
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    };
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await shot("sign-in");
    await page.goto("/sign-up");
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await shot("sign-up");
    const cookie = (value: string) =>
      context.addCookies([
        { name: "nanogent-test-session", value, domain: "127.0.0.1", path: "/" },
      ]);
    await cookie("empty");
    await page.goto("/");
    await expect(page.getByText("Start with a task", { exact: true })).toBeVisible();
    await shot("home-empty");
    await cookie("signed-in");
    await page.goto("/");
    await expect(
      page.getByRole("table").getByText("Handle reconnects", { exact: false }),
    ).toBeVisible();
    await shot("home-runs");
    await page.goto("/runs/new");
    await expect(page.getByLabel("Public repository URL")).toBeVisible();
    await shot("new-run");
    for (const [name, suffix] of [
      ["running", "1"],
      ["verified", "4"],
      ["failed", "7"],
      ["canceled", "8"],
    ]) {
      await page.goto(`/runs/run_000000demo_${suffix?.padStart(24, "0")}`);
      await expect(
        page
          .getByRole("region", { name: "Activity", exact: true })
          .getByText("Turn 1", { exact: true }),
      ).toBeVisible();
      await shot(`run-${name}`);
      if (viewport.width < 900) {
        if (name === "verified") {
          await page.getByRole("tab", { name: "Changes", exact: true }).click();
          await expect(page.getByRole("region", { name: "Diff", exact: true })).toBeVisible();
          await shot("run-changes");
        }
        await page.getByRole("tab", { name: "Verify", exact: true }).click();
        await shot(`run-${name}-verify`);
      }
    }
    await page.route(`**/api${verifiedRunPath}`, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.run.result.diff = longDiff;
      await route.fulfill({ json: data });
    });
    await page.goto(verifiedRunPath);
    if (viewport.width < 900) await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show rest (105 more lines)" })).toBeVisible();
    await shot("run-long-diff");
    await page.unroute(`**/api${verifiedRunPath}`);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await shot("command-palette");
    await page.keyboard.press("Escape");
    if (viewport.width >= 900) {
      await page.keyboard.press("Control+b");
      await shot("sidebar-collapsed");
    } else {
      await shot("sidebar-collapsed");
      await page.getByRole("button", { name: "Open runs menu" }).click();
      await expect(page.getByRole("dialog", { name: "Runs", exact: true })).toBeVisible();
      await shot("mobile-drawer");
    }
    expect(errors).toEqual([]);
  });
}
