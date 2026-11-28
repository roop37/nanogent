import { expect, test } from "@playwright/test";

test("imports projects, browses files and starts multiple sessions from the pinned commit", async ({
  page,
  context,
}) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.addCookies([
    { name: "nanogent-test-session", value: "github", domain: "127.0.0.1", path: "/" },
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
  const privateRun = await context.request.post("/api/runs", {
    data: { projectId: project.split("/").at(-1), task: "Inspect private files", maxCostUsd: 0.01 },
  });
  expect(privateRun.status()).toBe(403);
  await projects.getByRole("link", { name: "example/notes" }).click();
  await expect(page.getByRole("heading", { name: "example/notes", exact: true })).toBeVisible();
  const publicProject = new URL(page.url()).pathname;
  const publicProjectId = publicProject.split("/").at(-1);
  const runIds = [];
  const tasks = ["Plan the documentation", "Review the code"];
  for (const task of tasks) {
    await page.getByRole("link", { name: "New session", exact: true }).click();
    await expect(page.getByLabel("Repository source")).toHaveValue(publicProjectId ?? "");
    await expect(page.getByLabel("Public repository URL")).toHaveCount(0);
    await page.getByLabel("Task", { exact: true }).fill(task);
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/runs") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Start run" }).click({ timeout: 10_000 }),
    ]);
    expect(response.status()).toBe(202);
    const { id } = await response.json();
    runIds.push(id);
    await expect(page).toHaveURL(new RegExp(`/runs/${id}$`));
    const detail = await context.request.get(`/api/runs/${id}`);
    expect(await detail.json()).toMatchObject({
      run: {
        projectId: publicProjectId,
        spec: {
          task,
          repo: {
            url: "https://github.com/example/notes",
            ref: "0123456789abcdef0123456789abcdef01234567",
          },
        },
      },
    });
    await page.goto(publicProject);
  }
  expect(new Set(runIds).size).toBe(2);
  const sessions = page.getByRole("region", { name: "Project sessions" });
  for (const task of tasks)
    await expect(sessions.getByRole("link", { name: new RegExp(task) })).toBeVisible();
  const newRun = page.getByRole("link", { name: "New run", exact: true }).first();
  await expect(newRun).toHaveAttribute("href", `/runs/new?project=${publicProjectId}`);
  await newRun.click();
  await expect(page.getByLabel("Repository source")).toHaveValue(publicProjectId ?? "");
  await page.getByLabel("Repository source").selectOption("");
  await expect(page.getByLabel("Public repository URL")).toBeVisible();
  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  const foreignRun = await context.request.post("/api/runs", {
    data: { projectId: publicProjectId, task: "Review another user's project", maxCostUsd: 0.01 },
  });
  expect(foreignRun.status()).toBe(404);
  await page.goto(project);
  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "README.md", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "File contents" })).toHaveCount(0);
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
});
