import { expect, test } from "@playwright/test";
import { longDiff, verifiedRunPath } from "./run-fixtures";

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
  const errors: string[] = [];
  page.on("console", (message) => {
    if (/same key|unique.*key|hydration/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.request.get("/api/runs")).status()).toBe(401);
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  let polls = 0;
  let finish = false;
  let interrupt = false;
  await page.route(/\/api\/runs\/[^/]+\/events\?from=/, async (route) => {
    if (interrupt) {
      interrupt = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else if (polls < 2 || finish) {
      polls++;
      await route.continue();
    } else {
      const from = Number(new URL(route.request().url()).searchParams.get("from"));
      await route.fulfill({ json: { events: [], nextSeq: from, hasMore: false } });
    }
  });
  await page.goto("/runs/new");
  await page.getByLabel("Public repository URL").fill("https://github.com/example/calc");
  await page.getByLabel("Task", { exact: true }).fill("Fix the addition function");
  await page.getByText("Advanced", { exact: false }).click();
  await page.getByLabel("Verify command").fill("npm test");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/runs\/run_/);
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText("$ npm test", { exact: true })).toBeVisible();
  await expect(page.locator(".run-header").getByText("running", { exact: true })).toBeVisible();
  await activity.getByRole("button", { name: "Show all 18 lines" }).click();
  await expect(activity.getByText("Test 18: addition failed", { exact: false })).toBeVisible();
  await activity.getByRole("button", { name: "Show less" }).click();
  await expect(activity.getByText("Test 18: addition failed", { exact: false })).toHaveCount(0);

  interrupt = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  finish = true;
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.locator(".verification-badge")).toHaveText("Verified");
  await expect(activity.getByText("Turn 1", { exact: true })).toBeVisible();
  await expect(activity.getByText("str_replace calc.js", { exact: true })).toBeVisible();
  await expect(activity.getByText("Updated calc.js", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Verification details")).toContainText("1 test passed");
  const diff = page.getByRole("region", { name: "Diff", exact: true });
  await expect(diff).toContainText("export const add = (a, b) => a + b;");
  await diff.getByRole("button", { name: "Split", exact: true }).click();
  await expect(diff.locator('[data-view="split"]')).toBeVisible();
  await diff.getByRole("button", { name: "Unified", exact: true }).click();
  await expect(diff.locator('[data-view="unified"]')).toBeVisible();
  await diff.getByRole("button", { name: "Copy full patch" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "diff --git a/calc.js",
  );
  await expect(page.getByRole("button", { name: "Cancel run", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".verification-badge")).toHaveText("Verified");
  await expect(activity.getByText("str_replace calc.js", { exact: true })).toHaveCount(1);
  await expect(activity.locator(".timeline-step")).toHaveCount(9);
  expect(errors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(diff).toBeVisible();
  await expect(diff.getByRole("button", { name: "Split", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Verify", exact: true }).click();
  await expect(page.getByLabel("Verification details")).toContainText("1 test passed");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "example/calc", exact: true }).click();
  await expect(
    page.getByRole("table").getByRole("link", { name: "Fix the addition function" }).first(),
  ).toBeVisible();
});

test("an active run can be canceled with confirmation and the keyboard shortcut", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  // Hold event advancement while testing the dialog, irrespective of machine speed.
  await page.route(/\/api\/runs\/[^/]+\/events\?from=/, (route) =>
    route.fulfill({ json: { events: [], nextSeq: 1, hasMore: false } }),
  );
  const response = await context.request.post("/api/runs", {
    data: { repoUrl: "https://github.com/example/calc", task: "Cancel this run", maxCostUsd: 0.01 },
  });
  expect(response.status()).toBe(202);
  const { id } = await response.json();
  await page.goto(`/runs/${id}`);
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this run?", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("Control+.");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm cancel" }).click();
  await expect(page.locator(".run-header").getByText("canceled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run", exact: true })).toHaveCount(0);
});

test("large patches, file navigation, events and panel controls", async ({ page, context }) => {
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.route(`**/api${verifiedRunPath}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.run.result.diff = longDiff;
    await route.fulfill({ json: data });
  });
  await page.goto(verifiedRunPath);
  const diff = page.getByRole("region", { name: "Diff", exact: true });
  await expect(diff.getByRole("button", { name: "Show rest (105 more lines)" })).toBeVisible();
  await diff.getByRole("button", { name: "Show rest (105 more lines)" }).click();
  await expect(diff.locator(".diff-line")).toHaveCount(2105);
  await diff.getByRole("button", { name: "src/entries.ts", exact: true }).focus();
  await page.keyboard.press("[");
  await expect(diff.locator(".diff-code")).toHaveCount(0);
  await page.keyboard.press("]");
  await expect(diff.locator(".diff-code")).toBeVisible();
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await page.getByLabel("Filter events by type").selectOption("verify.result");
  await expect(page.locator(".raw-events > li")).toHaveCount(1);
  await page.getByRole("button", { name: "Collapse panel" }).click();
  await expect(page.getByLabel("Filter events by type")).not.toBeVisible();
  await page.getByRole("button", { name: "Expand panel" }).click();
  await expect(page.getByLabel("Filter events by type")).toBeVisible();
});
