import "server-only";
import { ModelSchema } from "@nanogent/config";
import {
  ConversationSchema,
  createRunId,
  DEFAULT_LIMITS,
  RunIdSchema,
  type RunSpec,
  RunSpecSchema,
} from "@nanogent/core";
import { z } from "zod";
import { active, type EventPage, type RunView } from "../types";
import { HttpError, requireSameOrigin, requireUser, type Session } from "./guard";
import type { settings } from "./settings";
export interface Backend {
  list(owner: string, projectId?: string, sessionId?: string, limit?: number): Promise<RunView[]>;
  get(owner: string, id: string): Promise<RunView | undefined>;
  events(id: string, from: number): Promise<EventPage>;
  withOwnerLock<T>(owner: string, work: () => Promise<T>): Promise<T>;
  allowance(owner: string): Promise<{ activeCount: number; charged: number }>;
  submit(spec: RunSpec, owner: string, projectId?: string, sessionId?: string): Promise<string>;
  cancel(id: string): Promise<void>;
}
const publicRepoUrl = z
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
  }, "Use a public HTTPS repository on GitHub, GitLab, or Bitbucket.");
const submissionFields = {
  task: z.string().trim().min(1).max(12000),
  verifyCommand: z.string().trim().min(1).max(2000).optional(),
  setupCommands: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  model: ModelSchema.optional(),
  maxCostUsd: z.number().finite().positive(),
};
export const submissionSchema = z.union([
  z.strictObject({ ...submissionFields, repoUrl: publicRepoUrl }),
  z.strictObject({ ...submissionFields, projectId: z.uuid(), sessionId: z.uuid().optional() }),
]);
export type Action = "list" | "submit" | "get" | "events" | "cancel";
export interface ApiDependencies {
  session(): Promise<Session>;
  settings(): ReturnType<typeof settings>;
  withBackend<T>(work: (backend: Backend) => Promise<T>): Promise<T>;
  resolveProjectRun?(
    owner: string,
    projectId: string,
    sessionId?: string,
  ): Promise<{ url: string; ref: string }>;
}

function recentConversation(runs: RunView[]) {
  const turns: NonNullable<RunSpec["conversation"]> = [];
  for (const run of runs) {
    if (run.state !== "completed" || !run.result?.summary.trim()) continue;
    const turn = { task: run.spec.task, answer: run.result.summary };
    if (!ConversationSchema.safeParse([turn, ...turns]).success) break;
    turns.unshift(turn);
  }
  return turns;
}
export function createApi(deps: ApiDependencies) {
  return async (action: Action, request: Request, id?: string): Promise<Response> => {
    try {
      const user = requireUser(await deps.session());
      if (action === "submit" || action === "cancel") requireSameOrigin(request);
      let spec: RunSpec | undefined;
      let projectId: string | undefined;
      let sessionId: string | undefined;
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
        const model = data.model ?? config.defaultModel;
        if (!config.models.includes(model) || data.maxCostUsd > config.maxCost)
          throw new HttpError(400, "Model or cost limit is not allowed.");
        projectId = "projectId" in data ? data.projectId : undefined;
        sessionId = "sessionId" in data ? data.sessionId : undefined;
        const repo =
          "repoUrl" in data
            ? { url: data.repoUrl }
            : sessionId
              ? await deps.resolveProjectRun?.(user.id, data.projectId, sessionId)
              : await deps.resolveProjectRun?.(user.id, data.projectId);
        if (!repo) throw new HttpError(503, "GitHub project sessions are unavailable.");
        spec = RunSpecSchema.parse({
          id: createRunId(),
          repo,
          task: data.task,
          setupCommands: data.setupCommands,
          ...(data.verifyCommand ? { verifyCommand: data.verifyCommand } : {}),
          model,
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
          const input = spec;
          return backend.withOwnerLock(user.id, async () => {
            const recent = sessionId ? await backend.list(user.id, projectId, sessionId, 6) : [];
            if (recent.some((run) => active(run.state)))
              throw new HttpError(409, "Wait for the current session run to finish.");
            const conversation = recentConversation(recent);
            const submitted = conversation.length ? { ...input, conversation } : input;
            const { activeCount, charged } = await backend.allowance(user.id);
            if (activeCount >= 3) throw new HttpError(429, "You already have three active runs.");
            if (charged + submitted.limits.maxCostUsd > config.dailyCap + 1e-9)
              throw new HttpError(
                429,
                "Daily budget is reserved or spent. Lower the run limit or try tomorrow (UTC).",
              );
            try {
              const id = sessionId
                ? await backend.submit(submitted, user.id, projectId, sessionId)
                : projectId
                  ? await backend.submit(submitted, user.id, projectId)
                  : await backend.submit(submitted, user.id);
              return { id };
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
