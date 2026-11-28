import { DraftVersionSchema, RunIdSchema } from "@nanogent/core";
import { getSession } from "@/lib/server/auth";
import { patchDraft } from "@/lib/server/draft-patch";
import { HttpError, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";
import { withBackend } from "@/lib/server/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const conflict = () =>
    new HttpError(
      409,
      "The draft changed since this run started. Open the session files and download the patch to review both versions.",
    );
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    const id = RunIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new HttpError(404, "Run not found.");
    const run = await withBackend((backend) => backend.get(user.id, id.data));
    if (!run?.projectId || !run.sessionId) throw new HttpError(404, "Session run not found.");
    if (run.state !== "completed" || !run.result?.diff)
      throw new HttpError(422, "This run has no completed patch to apply.");
    const { projectId, sessionId } = run;
    const version = DraftVersionSchema.safeParse(run.draftVersion);
    if (!version.success)
      throw new HttpError(422, "The run does not have a supported draft version.");
    const config = projectConfig();
    if (!config) throw new HttpError(503, "GitHub connection is not configured.");
    const { client, repo } = await authorizedProject(user.id, projectId, config);
    if (repo.private) throw new HttpError(403, "Draft editing requires a public project.");
    const [session, draft] = await withProjectStore((store) =>
      Promise.all([
        store.session(user.id, projectId, sessionId),
        store.draft(user.id, projectId, sessionId),
      ]),
    );
    if (!session || !draft) throw new HttpError(404, "Session not found.");
    if (draft.version !== version.data) throw conflict();
    const edits = await patchDraft(run.result.diff, draft, async (path) => {
      try {
        return (await client.content(repo.full_name, session.commitSha, path)).text;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    });
    const saved = await withProjectStore((store) =>
      store.saveDraftFiles(user.id, projectId, sessionId, version.data, edits),
    );
    if (saved === undefined) throw conflict();
    return Response.json({ version: saved }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not apply the patch." },
      { status: error instanceof HttpError ? error.status : 502, headers },
    );
  }
}
