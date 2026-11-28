import { DraftPathSchema, DraftTextSchema, DraftVersionSchema } from "@nanogent/core";
import { z } from "zod";
import { getSession } from "@/lib/server/auth";
import { containsDraftCredential } from "@/lib/server/draft-patch";
import { HttpError, readJson, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { authorizedProject, projectConfig } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

const edit = z.strictObject({
  path: DraftPathSchema,
  text: DraftTextSchema,
  version: DraftVersionSchema,
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    const ids = z.object({ id: z.uuid(), sessionId: z.uuid() }).safeParse(await context.params);
    const config = projectConfig();
    if (!ids.success || !config) throw new HttpError(404, "Session not found.");
    const { id, sessionId } = ids.data;
    const session = await withProjectStore((store) => store.session(user.id, id, sessionId));
    if (!session) throw new HttpError(404, "Session not found.");
    const body = await readJson(
      request,
      70 * 1024,
      "Send a draft file.",
      "Draft file is too large.",
    );
    const input = edit.safeParse(body);
    if (!input.success) throw new HttpError(400, "Choose an editable text file up to 32 KiB.");
    const { path, text, version } = input.data;
    if (containsDraftCredential(text))
      throw new HttpError(400, "Remove credentials before saving the draft.");
    const { client, repo } = await authorizedProject(user.id, id, config);
    if (repo.private) throw new HttpError(403, "Draft editing requires a public project.");
    const base = await client.content(repo.full_name, session.commitSha, path);
    if (base.text === null || !DraftTextSchema.safeParse(base.text).success)
      throw new HttpError(400, "Only existing UTF-8 text files up to 32 KiB can be edited.");
    const saved = await withProjectStore((store) =>
      store.saveDraftFile(user.id, id, sessionId, {
        version,
        path,
        text: text === base.text ? null : text,
      }),
    );
    if (saved === undefined)
      throw new HttpError(
        409,
        "The draft changed in another tab. Keep a copy of your edits and reload.",
      );
    return Response.json({ version: saved }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not save the draft." },
      { status: error instanceof HttpError ? error.status : 502, headers },
    );
  }
}
