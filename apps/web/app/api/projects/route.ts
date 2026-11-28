import { z } from "zod";
import { githubId } from "@/lib/projects";
import { getSession } from "@/lib/server/auth";
import { HttpError, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { projectConfig, projectConnection } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

const selection = z.strictObject({
  installationId: githubId,
  repositories: z.array(githubId).min(1).max(10),
});
async function readSelection(request: Request) {
  const reader = request.body?.getReader();
  if (!reader || !request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(400, "Select repositories to import.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 4000) {
      await reader.cancel();
      throw new HttpError(413, "Project selection is too large.");
    }
    chunks.push(item.value);
  }
  try {
    return selection.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new HttpError(400, "Select up to 10 repositories to import.");
  }
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
