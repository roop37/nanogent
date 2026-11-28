import { z } from "zod";

export const MAX_DRAFT_FILE_BYTES = 32 * 1024;
const bytes = (value: string) => new TextEncoder().encode(value).length;
export const DraftPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !/[%\\\p{Cc}\p{Cs}]/u.test(path) &&
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            ![".git", ".ssh", ".aws", ".config", ".nanogent", "node_modules"].includes(
              part.toLowerCase(),
            ) &&
            !part.toLowerCase().startsWith(".env"),
        ),
  );

export const DraftTextSchema = z
  .string()
  .max(MAX_DRAFT_FILE_BYTES)
  .refine(
    (text) =>
      bytes(text) <= MAX_DRAFT_FILE_BYTES && !/[\p{Cc}\p{Cs}]/u.test(text.replace(/[\n\r\t]/g, "")),
  );
export const DraftVersionSchema = z.int().min(0).max(2147483646);
export const DraftFilesSchema = z
  .array(
    z.strictObject({
      path: DraftPathSchema,
      text: DraftTextSchema,
    }),
  )
  .max(20)
  .refine(
    (files) =>
      files.reduce((total, file) => total + bytes(file.text), 0) <= 256 * 1024 &&
      new Set(files.map((file) => file.path)).size === files.length,
  );
export const DraftSnapshotSchema = z.strictObject({
  version: DraftVersionSchema,
  files: DraftFilesSchema,
});
export type DraftSnapshot = z.infer<typeof DraftSnapshotSchema>;
