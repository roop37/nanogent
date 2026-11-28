import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});
test("social sign-in uses the SDK proxy and safe return paths", async ({ page }) => {
  for (const provider of ["github", "google"]) {
    await page.goto("/sign-in?next=/runs/new");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    let body: Record<string, string> = {};
    await page.route("**/api/auth/sign-in/social", async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "PROVIDER_NOT_FOUND", message: "Provider not configured" }),
      });
    });
    await page
      .getByRole("button", { name: `Continue with ${provider === "github" ? "GitHub" : "Google"}` })
      .click();
    await expect(page.locator("p[role=alert]")).toContainText("sign-in isn't set up yet");
    expect(body.provider).toBe(provider);
    expect(body.callbackURL).toBe("/runs/new");
    expect(body.errorCallbackURL).toContain("/sign-in?provider=");
  }
  await page.goto("/sign-in?error=access_denied");
  await expect(page.locator("p[role=alert]")).toHaveText("Sign-in was cancelled");
});
test("email flow retains validation and errors", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" }),
    }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Email or password is incorrect.");
});
test("sign-in stays centered and hides the footer on short screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const form = page.locator(".auth-form");
  const demo = page.locator(".auth-demo");
  const formBox = await form.boundingBox();
  const demoBox = await demo.boundingBox();
  expect(formBox && demoBox).toBeTruthy();
  if (!formBox || !demoBox) throw new Error("Sign-in panels are missing");
  expect(Math.abs(formBox.y + formBox.height / 2 - (demoBox.y + demoBox.height / 2))).toBeLessThan(
    2,
  );
  await expect(page.locator(".auth-footer")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 680 });
  await expect(page.locator(".auth-footer")).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeInViewport();
});
test("overview shows readable durations and new run shows model pricing", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/");
  const table = page.getByRole("table");
  const running = table.getByRole("row").filter({ hasText: "Handle reconnects" });
  const elapsed = running.getByRole("cell").nth(4);
  await expect(elapsed).toHaveText(/^\d+m \d\ds$/);
  const first = await elapsed.textContent();
  await expect(elapsed).not.toHaveText(first ?? "");
  await expect(table.getByRole("row").filter({ hasText: "Add keyboard navigation" })).toContainText(
    "—",
  );
  await expect(
    table.getByRole("row").filter({ hasText: "Cache repository metadata" }),
  ).toContainText("25m 00s");
  const explorer = page.getByRole("navigation", { name: "Run explorer" });
  for (const group of ["Active", "Today", "Earlier"]) {
    const summary = explorer.locator(`details[aria-label="${group}"] > summary`);
    await expect(summary).toContainText(/\d+/);
    await summary.click();
    await expect(summary.locator("..")).not.toHaveAttribute("open", "");
  }
  await page.goto("/runs/new");
  await expect(page.locator(".status-bar").getByText("Haiku 5.5", { exact: true })).toHaveAttribute(
    "title",
    "Default model: claude-haiku-5-5",
  );
  await expect(page.getByLabel("Anthropic model")).toHaveValue("claude-haiku-5-5");
  await expect(page.locator("#model-pricing")).toHaveText("$0.1 input / $0.5 output per 1M tokens");
  await page.getByLabel("Anthropic model").selectOption("claude-sonnet-5-5");
  await expect(page.locator("#model-pricing")).toHaveText("$2 input / $10 output per 1M tokens");
  await expect(page.getByLabel("Max cost (USD)")).toHaveValue("0.1");
  await page.getByText("Advanced", { exact: false }).click();
  await page.getByLabel("Setup commands").focus();
  const actions = page.getByRole("button", { name: "Start run" });
  await expect(actions).toBeInViewport();
  const bottomGap = await actions.evaluate(
    (node) =>
      (document.querySelector(".status-bar")?.getBoundingClientRect().top ?? 0) -
      node.getBoundingClientRect().bottom,
  );
  expect(bottomGap).toBeGreaterThanOrEqual(12);
});
test("tabs, palette, keyboard explorer and mobile drawer", async ({ page, context }) => {
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("cursor pagination");
  await expect(dialog.getByRole("status")).toHaveText("1 result");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/000004$/);
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/runs\/new$/);
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "Open editors" })
      .getByRole("link", { name: "Fix cursor pagination", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close New run", exact: true }).click();
  await expect(page).toHaveURL(/000004$/);
  const explorer = page.getByRole("navigation", { name: "Run explorer" });
  await explorer.locator("a[data-run]").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(explorer.locator("a[data-run]").nth(1)).toBeFocused();
  await page.keyboard.press("Control+b");
  await expect(explorer).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open runs menu" }).click();
  await expect(page.getByRole("dialog", { name: "Runs", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
