import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { patchDraft } from "../lib/server/draft-patch";

const hash = (text: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0${text}`)
    .digest("hex");
const original = "first\nsecond\n";
const edited = "first\nupdated\n";
const patch = [
  "diff --git a/README.md b/README.md",
  `index ${hash(original)}..${hash(edited)} 100644`,
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -2 +2 @@",
  "-second",
  "+updated",
  "",
].join("\n");

it("checks the complete preimage even when the changed lines still match", async () => {
  const draft = { version: 1, files: [{ path: "README.md", text: "outside context\nsecond\n" }] };
  await expect(patchDraft(patch, draft, async () => original)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    patchDraft(
      patch.replace(hash(edited), "a".repeat(40)),
      { version: 0, files: [] },
      async () => original,
    ),
  ).rejects.toMatchObject({ status: 409 });
});

it.each([
  patch.replaceAll("README.md", ".git/config"),
  patch.replace("100644", "120000"),
  patch.replace("index ", "old mode 100755\nindex "),
  `${patch}\n[truncated]\n`,
  patch.replace(hash(original), hash(original).slice(0, 7)),
])("rejects unsupported patches before reading source", async (value) => {
  await expect(
    patchDraft(value, { version: 0, files: [] }, async () => {
      throw new Error("Unexpected source read");
    }),
  ).rejects.toMatchObject({ status: 422 });
});
