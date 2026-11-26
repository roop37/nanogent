import { posix } from "node:path";
import type { Tool } from "@nanogent/core";
import { z } from "zod";

export function workspacePath(path: string, workspace = "/workspace"): string {
  if (path.includes("%") || path.includes("\0"))
    throw new Error("Encoded or null paths are forbidden");
  const resolved = posix.resolve(workspace, path);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}/`))
    throw new Error("Path escapes /workspace");
  return resolved;
}
const bashInput = z.union([
  z.strictObject({ command: z.string().min(1), restart: z.literal(false).optional() }),
  z.strictObject({ restart: z.literal(true) }),
]);
const path = z.string().min(1);
const editorInput = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("view"),
    path,
    view_range: z.tuple([z.number().int().positive(), z.number().int().min(-1)]).optional(),
  }),
  z.strictObject({ command: z.literal("create"), path, file_text: z.string() }),
  z.strictObject({
    command: z.literal("str_replace"),
    path,
    old_str: z.string().min(1),
    new_str: z.string().default(""),
  }),
  z.strictObject({
    command: z.literal("insert"),
    path,
    insert_line: z.number().int().nonnegative(),
    insert_text: z.string(),
  }),
]);
const submitInput = z.strictObject({ summary: z.string().min(1).max(30_000) });

export function builtInTools(workspace = "/workspace"): Tool[] {
  return [
    {
      name: "bash",
      description: "Run a command in the persistent Bash session.",
      risk: "exec",
      inputSchema: bashInput,
      modelDefinition: { type: "bash_20250124", name: "bash" },
      async run(raw, ctx) {
        const input = bashInput.parse(raw);
        const result = await ctx.sandbox.bash("command" in input ? input.command : undefined, {
          timeoutSec: ctx.limits.commandTimeoutSec,
          maxOutputBytes: ctx.limits.maxToolOutputBytes,
          signal: ctx.signal,
          ...(input.restart !== undefined && { restart: input.restart }),
        });
        const output = `${result.stdout}${result.stderr}\nExit code: ${result.exitCode}${result.truncated ? " [truncated]" : ""}`;
        if (result.timedOut || result.exitCode !== 0) throw new Error(output);
        return output;
      },
    },
    {
      name: "str_replace_based_edit_tool",
      description: `View or edit files in ${workspace}.`,
      risk: "write",
      inputSchema: editorInput,
      modelDefinition: { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
      async run(raw, ctx) {
        const input = editorInput.parse(raw);
        const path = workspacePath(input.path, workspace);
        if (input.command === "create") {
          await ctx.sandbox.writeFile(path, input.file_text, ctx.signal);
          return `Created ${path}`;
        }
        const text = await ctx.sandbox.readFile(path, {
          maxBytes: ctx.limits.maxToolOutputBytes,
          signal: ctx.signal,
        });
        if (input.command === "view") {
          const lines = text.split("\n");
          const [start, end] = input.view_range ?? [1, -1];
          if (end !== -1 && end < start) throw new Error("Invalid view_range");
          return lines
            .slice(start - 1, end === -1 ? undefined : end)
            .map((line, i) => `${start + i}\t${line}`)
            .join("\n");
        }
        let updated: string;
        if (input.command === "str_replace") {
          const index = text.indexOf(input.old_str);
          if (index < 0 || text.indexOf(input.old_str, index + 1) >= 0)
            throw new Error("old_str must match exactly once");
          updated = text.slice(0, index) + input.new_str + text.slice(index + input.old_str.length);
        } else {
          const lines = text.split("\n");
          if (input.insert_line > lines.length) throw new Error("insert_line exceeds file length");
          lines.splice(input.insert_line, 0, input.insert_text);
          updated = lines.join("\n");
        }
        await ctx.sandbox.writeFile(path, updated, ctx.signal);
        return `Updated ${path}`;
      },
    },
    {
      name: "submit",
      description: "Submit the changes and a short summary for independent verification.",
      risk: "read",
      inputSchema: submitInput,
      modelDefinition: {
        name: "submit",
        description: "Submit a summary when finished.",
        eager_input_streaming: true,
        input_schema: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      async run(raw) {
        return submitInput.parse(raw).summary;
      },
    },
  ];
}
