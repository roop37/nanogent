import "server-only";
import { DEFAULT_MODEL, ModelSchema } from "@nanogent/config";
import {
  createRunId,
  DEFAULT_LIMITS,
  RunIdSchema,
  type RunSpec,
  RunSpecSchema,
} from "@nanogent/core";
import { z } from "zod";
import type { EventPage, RunView } from "../types";
import { HttpError, requireSameOrigin, requireUser, type Session } from "./guard";
import type { settings } from "./settings";
export interface Backend {
  list(owner: string): Promise<RunView[]>;
  get(owner: string, id: string): Promise<RunView | undefined>;
  events(id: string, from: number): Promise<EventPage>;
  withOwnerLock<T>(owner: string, work: () => Promise<T>): Promise<T>;
  allowance(owner: string): Promise<{ activeCount: number; charged: number }>;
  submit(spec: RunSpec, owner: string): Promise<string>;
  cancel(id: string): Promise<void>;
}
export const submissionSchema = z.strictObject({
  repoUrl: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      // Public git hosts keep repository input away from private network endpoints.
      return (
        url.protocol === "https:" &&
        ["github.com", "gitlab.com", "bitbucket.org"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        /^\/[\w.-]+(?:\/[\w.-]+)+\/?$/.test(url.pathname)
      );
    }, "Use a public HTTPS repository on GitHub, GitLab, or Bitbucket."),
  task: z.string().trim().min(1).max(12000),
  verifyCommand: z.string().trim().min(1).max(2000).optional(),
  setupCommands: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  model: ModelSchema.default(DEFAULT_MODEL),
  maxCostUsd: z.number().finite().positive(),
});
export type Action = "list" | "submit" | "get" | "events" | "cancel";
export interface ApiDependencies {
  session(): Promise<Session>;
  settings(): ReturnType<typeof settings>;
  withBackend<T>(work: (backend: Backend) => Promise<T>): Promise<T>;
}
export function createApi(deps: ApiDependencies) {
  return async (action: Action, request: Request, id?: string): Promise<Response> => {
    try {
      const user = requireUser(await deps.session());
      if (action === "submit" || action === "cancel") requireSameOrigin(request);
      let spec: RunSpec | undefined;
      const config = deps.settings();
      if (action === "submit") {
        if (!request.headers.get("content-type")?.startsWith("application/json"))
          throw new HttpError(415, "Send JSON.");
        const reader = request.body?.getReader();
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > 40_000) {
              await reader.cancel();
              throw new HttpError(413, "Request is too large.");
            }
            chunks.push(item.value);
          }
        }
        let input: unknown;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new HttpError(400, "Invalid JSON.");
        }
        const parsed = submissionSchema.safeParse(input);
        if (!parsed.success)
          throw new HttpError(400, "Check the repository, task, commands, model, and cost limit.");
        const data = parsed.data;
        if (!config.models.includes(data.model) || data.maxCostUsd > config.maxCost)
          throw new HttpError(400, "Model or cost limit is not allowed.");
        spec = RunSpecSchema.parse({
          id: createRunId(),
          repo: { url: data.repoUrl },
          task: data.task,
          setupCommands: data.setupCommands,
          ...(data.verifyCommand ? { verifyCommand: data.verifyCommand } : {}),
          model: data.model,
          effort: "medium",
          refusalFallback: false,
          limits: { ...DEFAULT_LIMITS, maxCostUsd: data.maxCostUsd },
        });
      }
      if (id !== undefined && !RunIdSchema.safeParse(id).success)
        throw new HttpError(404, "Run not found.");
      const rawFrom = new URL(request.url).searchParams.get("from") ?? "1";
      const cursor = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).safeParse(rawFrom);
      if (action === "events" && (!/^\d+$/.test(rawFrom) || !cursor.success))
        throw new HttpError(400, "Invalid event cursor.");
      const data = await deps.withBackend(async (backend) => {
        if (action === "list")
          return { runs: await backend.list(user.id), allowance: await backend.allowance(user.id) };
        if (action === "submit" && spec) {
          const submitted = spec;
          return backend.withOwnerLock(user.id, async () => {
            const { activeCount, charged } = await backend.allowance(user.id);
            if (activeCount >= 3) throw new HttpError(429, "You already have three active runs.");
            if (charged + submitted.limits.maxCostUsd > config.dailyCap + 1e-9)
              throw new HttpError(
                429,
                "Daily budget is reserved or spent. Lower the run limit or try tomorrow (UTC).",
              );
            try {
              return { id: await backend.submit(submitted, user.id) };
            } catch {
              if (await backend.get(user.id, submitted.id))
                return {
                  id: submitted.id,
                  warning:
                    "Run saved, but its start could not be confirmed. It begins when the runner picks it up.",
                };
              throw new HttpError(503, "Could not submit the run. Try again.");
            }
          });
        }
        if (!id) throw new HttpError(404, "Run not found.");
        const run = await backend.get(user.id, id);
        if (!run) throw new HttpError(404, "Run not found.");
        if (action === "get") return { run };
        if (action === "events" && cursor.success) return backend.events(id, cursor.data);
        await backend.cancel(id);
        return { ok: true };
      });
      return Response.json(data, {
        status: action === "submit" ? 202 : 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      const known = error instanceof HttpError;
      return Response.json(
        { error: known ? error.message : "Service unavailable. Try again shortly." },
        { status: known ? error.status : 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  };
}
