import { DraftPathSchema, DraftTextSchema, DraftVersionSchema } from "@nanogent/core";
import { z } from "zod";
import { parentPath } from "@/lib/projects";
import { getSession } from "@/lib/server/auth";
import { containsDraftCredential } from "@/lib/server/draft-patch";
import { HttpError, readJson, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { authorizedProject, projectConfig, sessionSource } from "@/lib/server/project-runtime";
import { withProjectStore } from "@/lib/server/project-store";

const fields = { path: DraftPathSchema, version: DraftVersionSchema };
const edit = z.strictObject({ ...fields, text: DraftTextSchema });
const operation = z.discriminatedUnion("operation", [
  z.strictObject({ ...fields, operation: z.literal("create") }),
  z.strictObject({ ...fields, operation: z.literal("delete") }),
  z.strictObject({ ...fields, operation: z.literal("restore") }),
  z.strictObject({ ...fields, operation: z.literal("rename"), target: DraftPathSchema }),
]);

async function updateDraft(
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
    const input = (request.method === "PUT" ? edit : operation).safeParse(body);
    if (!input.success) throw new HttpError(400, "Choose an editable text file up to 32 KiB.");
    const data = input.data;
    const { path, version } = data;
    const { client, repo } = await authorizedProject(user.id, id, config);
    if (repo.private) throw new HttpError(403, "Draft editing requires a public project.");
    const conflict = () =>
      new HttpError(409, "The draft changed in another tab. Keep a copy of your edits and reload.");
    const draft = await withProjectStore((store) => store.draft(user.id, id, sessionId));
    if (!draft || draft.version !== version) throw conflict();
    const read = (path: string) => sessionSource(client, repo.full_name, session.commitSha, path);
    const overlay = draft.files.find((file) => file.path === path);
    const base = await read(path);
    const text = overlay ? overlay.text : (base?.text ?? null);
    const edits: { path: string; text: string | null; deleted?: true }[] = [];

    if ("text" in data) {
      if (text === null || !DraftTextSchema.safeParse(text).success)
        throw new HttpError(400, "Choose an editable UTF-8 file up to 32 KiB.");
      if (containsDraftCredential(data.text))
        throw new HttpError(400, "Remove credentials before saving the draft.");
      edits.push({ path, text: data.text === base?.text ? null : data.text });
    } else if (data.operation === "create") {
      if (overlay || base) throw new HttpError(409, "That name already exists in this folder.");
      if (!(await read(parentPath(path)))?.entries)
        throw new HttpError(400, "Choose an existing folder.");
      edits.push({ path, text: "" });
    } else if (data.operation === "restore") {
      if (overlay?.text !== null || !base)
        throw new HttpError(409, "This file is already available.");
      edits.push({ path, text: null });
    } else {
      if (text === null || !DraftTextSchema.safeParse(text).success)
        throw new HttpError(400, "Only editable UTF-8 files support this action.");
      if (data.operation === "rename") {
        const { target } = data;
        if (parentPath(target) !== parentPath(path))
          throw new HttpError(400, "Choose a filename in the same folder.");
        if (draft.files.some((file) => file.path === target) || (await read(target)))
          throw new HttpError(409, "That name already exists in this folder.");
        if (containsDraftCredential(text))
          throw new HttpError(400, "Remove credentials before renaming the file.");
        edits.push({ path: target, text });
      }
      edits.push({ path, text: null, ...(base && { deleted: true }) });
    }
    const saved = await withProjectStore((store) =>
      store.saveDraftFiles(user.id, id, sessionId, version, edits),
    );
    if (saved === undefined) throw conflict();
    return Response.json({ version: saved }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not save the draft." },
      { status: error instanceof HttpError ? error.status : 502, headers },
    );
  }
}

export const PUT = updateDraft;
export const POST = updateDraft;
