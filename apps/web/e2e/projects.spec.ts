import { expect, test } from "@playwright/test";

test("imports projects, pins branches and starts independent runs from their saved commits", async ({
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
  const newRunPath = `/runs/new?project=${publicProjectId}`;
  const original = { branch: "main", commitSha: "0123456789abcdef0123456789abcdef01234567" };
  const feature = { branch: "feature/docs", commitSha: "123456789abcdef0123456789abcdef012345678" };
  const runIds = [];
  const tasks = ["Plan the documentation", "Review the code"];
  for (const [index, task] of tasks.entries()) {
    if (index === 1) {
      await page.getByRole("button", { name: "Change branch" }).click();
      await page.getByRole("button", { name: "Load more branches" }).click();
      await page.getByLabel("Project branch").selectOption(feature.branch);
      await page.getByRole("button", { name: "Pin branch" }).click();
      await expect(page.getByText("feature/docs · 12345678")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("link", { name: "GUIDE.md" })).toBeVisible();
      const stale = await context.request.patch(`/api${publicProject}/branches`, {
        data: { branch: feature.branch, expected: original },
      });
      expect(stale.status()).toBe(409);
    }
    await page.getByRole("main").getByRole("link", { name: "New run", exact: true }).click();
    await expect(page).toHaveURL(newRunPath, { timeout: 15_000 });
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
            ref: index === 0 ? original.commitSha : feature.commitSha,
          },
        },
      },
    });
    await page.goto(publicProject);
  }
  expect(new Set(runIds).size).toBe(2);
  const firstRun = await context.request.get(`/api/runs/${runIds[0]}`);
  expect(await firstRun.json()).toMatchObject({
    run: { spec: { repo: { ref: original.commitSha } } },
  });
  const sessions = page.getByRole("region", { name: "Project sessions" });
  for (const task of tasks)
    await expect(sessions.getByRole("link", { name: new RegExp(task) })).toBeVisible();
  const newRun = page.getByRole("link", { name: "New run", exact: true }).first();
  await expect(newRun).toHaveAttribute("href", newRunPath);
  await newRun.click();
  await expect(page).toHaveURL(newRunPath, { timeout: 15_000 });
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
  const foreignBranches = await context.request.get(`/api${publicProject}/branches`);
  expect(foreignBranches.status()).toBe(404);
  await page.goto(project);
  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "README.md", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "File contents" })).toHaveCount(0);
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
});

test("reopens named sessions and sends follow-ups with their own history and pin", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "nanogent-test-session", value: "github-sessions", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/projects");
  await page.getByRole("checkbox", { name: /example\/notes/ }).check();
  await page.getByRole("button", { name: "Import 1 project", exact: true }).click();
  const projects = page.getByRole("navigation", { name: "Projects", exact: true });
  await projects.getByRole("link", { name: "example/notes" }).click();
  await expect(page.getByRole("heading", { name: "example/notes" })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;
  const projectId = projectPath.split("/").at(-1);
  const pin = { branch: "main", commitSha: "0123456789abcdef0123456789abcdef01234567" };
  const editors = page.getByRole("navigation", { name: "Open editors" });

  async function createSession(name: string) {
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByLabel("Session name").fill(name);
    await page.getByRole("button", { name: "Create session", exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(editors.getByRole("link", { name, exact: true })).toBeVisible();
    return new URL(page.url()).pathname;
  }

  async function submit(task: string) {
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
    await expect(page).toHaveURL(new RegExp(`/runs/${id}$`));
    return id;
  }

  const first = await createSession("Documentation");
  await page.getByRole("link", { name: "Start session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New run", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Repository source")).toHaveCount(0);
  const firstRunId = await submit("Review the existing documentation");
  await expect(page.locator(".run-header").getByText("completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const firstRun = await context.request.get(`/api/runs/${firstRunId}`);
  expect(await firstRun.json()).toMatchObject({ run: { sessionId: first.split("/").at(-1) } });

  const moved = await context.request.patch(`/api${projectPath}/branches`, {
    data: { branch: "feature/docs", expected: pin },
  });
  expect(moved.status()).toBe(200);
  await page.goto(projectPath);
  const second = await createSession("Release notes");
  await expect(page.getByText("No runs yet.")).toBeVisible();
  await expect(page.getByText("feature/docs · 12345678")).toBeVisible();
  await editors.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page).toHaveURL(first, { timeout: 15_000 });
  await page.reload();
  const conversation = page.getByRole("list", { name: "Session conversation" });
  await expect(conversation).toContainText("Review the existing documentation");
  await expect(conversation).toContainText("Fixed the addition function.");
  await expect(editors.getByRole("link", { name: "Release notes", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue session", exact: true }).click();
  const followUpId = await submit("Summarize the earlier review");
  const followUp = await context.request.get(`/api/runs/${followUpId}`);
  expect(await followUp.json()).toMatchObject({
    run: {
      sessionId: first.split("/").at(-1),
      spec: {
        repo: { ref: pin.commitSha },
        conversation: [
          { task: "Review the existing documentation", answer: "Fixed the addition function." },
        ],
      },
    },
  });

  const otherTask = {
    projectId,
    sessionId: second.split("/").at(-1),
    task: "Draft notes",
    maxCostUsd: 0.01,
  };
  const otherRun = await context.request.post("/api/runs", { data: otherTask });
  expect(otherRun.status()).toBe(202);
  const { id: otherRunId } = await otherRun.json();
  const otherDetail = await context.request.get(`/api/runs/${otherRunId}`);
  expect((await otherDetail.json()).run.spec).not.toHaveProperty("conversation");
  const duplicate = await context.request.post("/api/runs", { data: otherTask });
  expect(duplicate.status()).toBe(409);

  await context.addCookies([
    { name: "nanogent-test-session", value: "empty", domain: "127.0.0.1", path: "/" },
  ]);
  const foreign = await context.request.post("/api/runs", { data: otherTask });
  expect(foreign.status()).toBe(404);
  await page.goto("/");
  await expect(editors.getByRole("link", { name: "Documentation", exact: true })).toHaveCount(0);
});
