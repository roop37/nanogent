import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

test("signed-in submission streams events, survives reload, and shows a verified diff", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  const anonymous = await context.request.get("/api/runs");
  expect(anonymous.status()).toBe(401);
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/runs/new");
  await page.getByLabel("Public repository URL").fill("https://github.com/example/calc");
  await page.getByLabel("Task", { exact: true }).fill("Fix the addition function");
  await page.getByText("Advanced", { exact: false }).click();
  await page.getByLabel("Verify command").fill("npm test");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/runs\/run_/);
  let interrupted = false;
  await page.route(/\/api\/runs\/[^/]+\/events\?from=/, async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByText("Connection interrupted. Retrying shortly.")).toBeVisible();
  await expect(page.getByText("Verified: pass", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Model response", { exact: false })).toBeVisible();
  await expect(page.getByText("str_replace_editor", { exact: true })).toBeVisible();
  const output = page.getByText("Updated calc.js", { exact: true });
  await expect(output).not.toBeVisible();
  await page.getByText("Tool result · done", { exact: false }).click();
  await expect(output).toBeVisible();
  await expect(page.getByText("1 test passed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Diff")).toContainText("+export const add = (a, b) => a + b;");
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Verified: pass", { exact: true })).toBeVisible();
  await expect(page.getByText("str_replace_editor", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: "test-results/run-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/run-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "All runs" }).click();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Fix the addition function" }),
  ).toBeVisible();
});
test("an active run can be canceled", async ({ page, context }) => {
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  // The fake run finishes after a few seconds; compile the run page first so a cold dev server
  // doesn't use up that window before the cancel button is clicked.
  await page.goto("/runs/run_0000000000_000000000000000000000000");
  const response = await context.request.post("/api/runs", {
    data: { repoUrl: "https://github.com/example/calc", task: "Cancel this run", maxCostUsd: 0.1 },
  });
  expect(response.status()).toBe(202);
  const { id } = await response.json();
  await page.goto(`/runs/${id}`);
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByRole("main").getByText("canceled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
});
