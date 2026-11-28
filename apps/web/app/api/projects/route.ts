import { z } from "zod";
import { githubId } from "@/lib/projects";
import { getSession } from "@/lib/server/auth";
import { HttpError, readJson, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { projectConfig, projectConnection } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

const selection = z.strictObject({
  installationId: githubId,
  repositories: z.array(githubId).min(1).max(10),
});
async function readSelection(request: Request) {
  const input = await readJson(
    request,
    4000,
    "Select repositories to import.",
    "Project selection is too large.",
  );
  const result = selection.safeParse(input);
  if (!result.success) throw new HttpError(400, "Select up to 10 repositories to import.");
  return result.data;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    const config = projectConfig();
    if (!config) throw new HttpError(503, "GitHub connection is not configured.");
    const { installationId, repositories } = await readSelection(request);
    const { client } = await projectConnection(user.id, config);
    const allowed = await client.authorizedRepos(installationId, [...new Set(repositories)]);
    const projects = await Promise.all(
      allowed.map(async (repo) => ({
        installationId,
        repositoryId: repo.id,
        fullName: repo.full_name,
        branch: repo.default_branch,
        commitSha: await client.head(repo.full_name, repo.default_branch),
      })),
    );
    await withProjectStore((store) => store.save(user.id, projects));
    return Response.json(
      { imported: projects.length },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof HttpError ? error.message : "Could not import the selected projects.",
      },
      {
        status: error instanceof HttpError ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
