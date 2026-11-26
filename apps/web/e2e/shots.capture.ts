import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`screens at ${viewport.width}`, async ({ page, context }) => {
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
    await page.goto("/runs/run_000000demo_000000000000000000000004");
    await expect(page.getByText("Verified: pass", { exact: true })).toBeVisible();
    await expect(page.getByText("Model response", { exact: false })).toBeVisible();
    await shot("run");
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
  });
}
