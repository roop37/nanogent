import "server-only";
import { createHash } from "node:crypto";
import {
  DraftPathSchema,
  type DraftSnapshot,
  DraftTextSchema,
  MAX_DRAFT_FILE_BYTES,
  redact,
} from "@nanogent/core";
import { applyPatch, parsePatch } from "diff";
import { HttpError } from "./guard";

export function containsDraftCredential(text: string) {
  return redact(text) !== text || /postgres(?:ql)?:\/\/[^\s@]*:[^\s@]+@/i.test(text);
}

function blobHash(text: string) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
}

function parseTextPatch(patch: string) {
  const unsupported = () =>
    new HttpError(
      422,
      "Apply needs a complete patch of existing text files. Download the patch for manual review.",
    );
  if (
    !patch.startsWith("diff --git ") ||
    !patch.endsWith("\n") ||
    Buffer.byteLength(patch) > 64 * 1024 ||
    patch.includes("\n[truncated]\n") ||
    patch.includes("[REDACTED]")
  )
    throw unsupported();
  const sections = patch.split(/(?=^diff --git )/m);
  if (sections.length > 20) throw unsupported();
  const seen = new Set<string>();
  return sections.map((section) => {
    const [, index, oldHeader, newHeader] = section.split("\n", 4);
    const blob = /^index ([a-f0-9]{40})\.\.([a-f0-9]{40}) 100(?:644|755)$/.exec(index ?? "");
    if (!blob || !oldHeader?.startsWith("--- ") || !newHeader?.startsWith("+++ "))
      throw unsupported();
    const [before, after] = blob.slice(1);
    let files: ReturnType<typeof parsePatch>;
    try {
      files = parsePatch(section);
    } catch {
      throw unsupported();
    }
    const file = files[0];
    const path = file?.oldFileName?.slice(2) ?? "";
    if (
      !file ||
      files.length !== 1 ||
      !file.oldFileName?.startsWith("a/") ||
      file.newFileName !== `b/${path}` ||
      !file.hunks.length ||
      !DraftPathSchema.safeParse(path).success ||
      seen.has(path) ||
      file.hunks.some((hunk) =>
        [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].some(
          (number) =>
            !Number.isSafeInteger(number) || number < 0 || number > MAX_DRAFT_FILE_BYTES + 1,
        ),
      )
    )
      throw unsupported();
    seen.add(path);
    return { file, path, before, after };
  });
}

export async function patchDraft(
  patch: string,
  draft: DraftSnapshot,
  original: (path: string) => Promise<string | null>,
) {
  const files = parseTextPatch(patch);
  const saved = new Map(draft.files.map(({ path, text }) => [path, text]));
  return Promise.all(
    files.map(async ({ file, path, before, after }) => {
      const base = await original(path);
      const conflict = () =>
        new HttpError(
          409,
          "The patch does not match the saved draft. Download it to review the differences.",
        );
      const overlay = saved.get(path);
      if (overlay === null) throw conflict();
      const current = overlay ?? base;
      if (current === null || !DraftTextSchema.safeParse(current).success)
        throw new HttpError(
          422,
          "The patch contains a file that cannot be edited in a session draft.",
        );
      if (blobHash(current) !== before) throw conflict();
      const text = applyPatch(current, file, { fuzzFactor: 0, autoConvertLineEndings: false });
      if (text === false || blobHash(text) !== after) throw conflict();
      if (!DraftTextSchema.safeParse(text).success || containsDraftCredential(text))
        throw new HttpError(422, "The patched file exceeds draft limits or contains credentials.");
      return { path, text: text === base ? null : text };
    }),
  );
}
