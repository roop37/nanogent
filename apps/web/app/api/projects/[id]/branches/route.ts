import { z } from "zod";
import { branchName, commitSha } from "@/lib/projects";
import { getSession } from "@/lib/server/auth";
import { HttpError, readJson, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
const pinChange = z.strictObject({
  branch: branchName,
  expected: z.strictObject({ branch: branchName, commitSha }),
});
const pageNumber = z.coerce.number().int().min(1).max(1000);

async function access(context: Context) {
  const user = requireUser(await getSession());
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) throw new HttpError(404, "Project not found.");
  const config = projectConfig();
  if (!config) throw new HttpError(503, "GitHub connection is not configured.");
  return { owner: user.id, ...(await authorizedProject(user.id, id.data, config)) };
}

function failure(error: unknown, fallback: string) {
  return Response.json(
    { error: error instanceof HttpError ? error.message : fallback },
    { status: error instanceof HttpError ? error.status : 502, headers },
  );
}

export async function GET(request: Request, context: Context) {
  try {
    const page = pageNumber.safeParse(new URL(request.url).searchParams.get("page") ?? "1");
    if (!page.success) throw new HttpError(400, "Invalid branch page.");
    const { client, repo } = await access(context);
    return Response.json(await client.branches(repo.full_name, page.data), { headers });
  } catch (error) {
    return failure(error, "Could not load branches.");
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { owner, project, client, repo } = await access(context);
    const input = await readJson(
      request,
      4000,
      "Select a branch.",
      "Branch selection is too large.",
    );
    const body = pinChange.safeParse(input);
    if (!body.success) throw new HttpError(400, "Select a valid branch.");
    const { branch, expected } = body.data;
    const latest = await client.branchHead(repo.full_name, branch);
    const pin = { branch, commitSha: latest };
    const updated = await withProjectStore((store) =>
      store.updatePin(owner, project.id, expected, pin),
    );
    if (!updated)
      throw new HttpError(409, "The project pin changed. Reload before choosing a branch.");
    return Response.json(pin, { headers });
  } catch (error) {
    return failure(error, "Could not update the project branch.");
  }
}
