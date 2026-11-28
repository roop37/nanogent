import { z } from "zod";
import { sessionName } from "@/lib/projects";
import { getSession } from "@/lib/server/auth";
import { HttpError, readJson, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

const payload = z.strictObject({ name: sessionName });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    const id = z.uuid().safeParse((await context.params).id);
    if (!id.success) throw new HttpError(404, "Project not found.");
    const input = await readJson(
      request,
      2048,
      "Enter a session name.",
      "Session name is too large.",
    );
    const body = payload.safeParse(input);
    if (!body.success) throw new HttpError(400, "Enter a session name of up to 100 characters.");
    const config = projectConfig();
    if (!config) throw new HttpError(503, "GitHub connection is not configured.");
    const { repo } = await authorizedProject(user.id, id.data, config);
    if (repo.private) throw new HttpError(403, "Hosted sessions require a public repository.");
    const session = await withProjectStore((store) =>
      store.createSession(user.id, id.data, body.data.name),
    );
    if (!session) throw new HttpError(404, "Project not found.");
    return Response.json({ id: session.id }, { status: 201, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not create the session." },
      { status: error instanceof HttpError ? error.status : 502, headers },
    );
  }
}
