import { expect, test } from "@playwright/test";
import { longDiff, runningRunPath, verifiedRunPath } from "./run-fixtures";

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
  let holdAt = Number.POSITIVE_INFINITY;
  let finish = false;
  let interrupt = false;
  await page.route(/\/api\/runs\/[^/]+\/events\?from=/, async (route) => {
    const from = Number(new URL(route.request().url()).searchParams.get("from"));
    if (interrupt && from === 1) {
      interrupt = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else if (finish) {
      await route.continue();
    } else if (from >= holdAt) {
      await route.fulfill({ json: { events: [], nextSeq: from, hasMore: false } });
    } else {
      const response = await route.fetch();
      if (response.ok()) {
        const page = (await response.json()) as import("../lib/types").EventPage;
        if (page.events.some((event) => event.type === "tool.result")) holdAt = page.nextSeq;
      }
      await route.fulfill({ response });
    }
  });
  await page.goto("/runs/new");
  await page.getByLabel("Public repository URL").fill("https://github.com/example/calc");
  await page.getByLabel("Task", { exact: true }).fill("Fix the addition function");
  await page.getByLabel("Anthropic model").selectOption("claude-sonnet-5-5");
  await page.getByText("Advanced", { exact: false }).click();
  await page.getByLabel("Verify command").fill("npm test");
  const submission = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start run" }).click();
  const submitted = await submission;
  expect(submitted.status()).toBe(202);
  const { id } = await submitted.json();
  await expect(page).toHaveURL(`/runs/${id}`, { timeout: 15000 });
  await expect(page.locator(".run-metrics").getByText("Sonnet 5.5", { exact: true })).toBeVisible();
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText("$ npm test", { exact: true })).toBeVisible();
  await expect(page.locator(".run-header").getByText("running", { exact: true })).toBeVisible();
  await activity.getByRole("button", { name: "Show all 18 lines" }).click();
  await expect(activity.getByText("Test 18: addition failed", { exact: false })).toBeVisible();
  await activity.getByRole("button", { name: "Show less" }).click();
  await expect(activity.getByText("Test 18: addition failed", { exact: false })).toHaveCount(0);

  interrupt = true;
  await page.reload();
  const notice = page.getByRole("alert").filter({ hasText: "Connection interrupted" });
  await expect(notice).toBeVisible();
  finish = true;
  await notice.getByRole("button", { name: "Retry now" }).click();
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
  await expect(activity.locator(".timeline-step")).toHaveCount(8);
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

test("a written result opens above the activity and can be copied", async ({ page, context }) => {
  const plan = "CSV converter UI plan\n\n1. Add a file picker.\n2. Preview the first ten rows.";
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.route(`**/api${verifiedRunPath}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.run.spec.verifyCommand;
    Object.assign(data.run.result, { summary: plan, diff: "", verify: null, verified: false });
    await route.fulfill({ json: data });
  });
  await page.route(`**/api${verifiedRunPath}/events?*`, (route) =>
    route.fulfill({ json: { events: [], nextSeq: 1, hasMore: false } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(verifiedRunPath);
  const result = page.getByRole("region", { name: "Result", exact: true });
  await expect(result).toContainText("Preview the first ten rows.");
  await expect(page.locator(".verification-badge")).toHaveText("No verification configured");
  await result.getByRole("button", { name: "Copy result" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(plan);
  await page.getByRole("button", { name: "View activity" }).click();
  await expect(page.getByRole("region", { name: "Activity", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to result" }).click();
  await expect(result).toBeVisible();
  await page.reload();
  await expect(result).toContainText("Add a file picker.");
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

test("a running snapshot stays available across resize, reload and offline recovery", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto(runningRunPath);
  const diff = page.getByRole("region", { name: "Diff", exact: true });
  await expect(diff).toContainText("withCredentials: true");
  const clock = page.locator(".run-metrics dd").first();
  const divider = page.getByRole("separator", { name: "Resize activity and changes" });
  const original = await divider.getAttribute("aria-valuenow");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).not.toHaveAttribute("aria-valuenow", original ?? "");
  const resized = await divider.getAttribute("aria-valuenow");
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", resized ?? "");
  await expect(clock).not.toHaveText("—");
  await context.setOffline(true);
  const notice = page.getByRole("main").getByRole("alert");
  await expect(notice).toContainText("You are offline.");
  await expect(page.locator(".status-bar")).toContainText("Offline");
  await expect(diff).toContainText("withCredentials: true");
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("Connected");
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
