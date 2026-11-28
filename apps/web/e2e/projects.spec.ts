import { expect, test } from "@playwright/test";

test("imports multiple authorized projects and browses files at the pinned commit", async ({
  page,
  context,
}) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.addCookies([
    { name: "nanogent-test-session", value: "signed-in", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/projects");
  await expect(page.getByText("Connected as")).toContainText("example");
  await page.getByRole("checkbox", { name: /example\/calc/ }).check();
  await page.getByRole("checkbox", { name: /example\/notes/ }).check();
  await page.getByRole("button", { name: "Import 2 projects" }).click();
  await expect(page.getByText("2 projects imported.")).toBeVisible();
  const projects = page.getByRole("navigation", { name: "Projects", exact: true });
  await expect(projects.getByRole("link", { name: "example/notes" })).toBeVisible();
  await projects.getByRole("link", { name: "example/calc" }).click();
  await expect(page.getByText("main · 01234567")).toBeVisible();
  await page.getByRole("link", { name: "README.md", exact: true }).click();
  await expect(page.getByRole("region", { name: "File contents" })).toContainText("pinned commit");
  await page.reload();
  await expect(page.getByRole("region", { name: "File contents" })).toContainText("pinned commit");
  const project = new URL(page.url()).pathname;
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto(project);
  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "README.md", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "File contents" })).toHaveCount(0);
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
});
