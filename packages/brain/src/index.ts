import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "@nanogent/config";
import {
  type AgentContext,
  type AgentOutcome,
  type Brain,
  capOutput,
  type Usage,
} from "@nanogent/core";

type StreamMethod = Anthropic["beta"]["messages"]["stream"];
export type MessageRequest = Parameters<StreamMethod>[0];
export interface MessagesClient {
  stream(
    params: MessageRequest,
    options?: Parameters<StreamMethod>[1],
  ): Pick<ReturnType<StreamMethod>, "finalMessage">;
}

async function checkBudget(ctx: AgentContext): Promise<void> {
  ctx.signal.throwIfAborted();
  const check = ctx.budget.check();
  if (!check.ok) {
    const s = ctx.budget.snapshot();
    const actual = {
      maxTurns: s.turns,
      maxToolCalls: s.toolCalls,
      maxCostUsd: s.usage.costUsd,
      maxInputTokens: s.usage.input + s.usage.cacheRead + s.usage.cacheWrite,
      maxOutputTokens: s.usage.output,
      maxWallClockSec: s.elapsedMs / 1000,
      commandTimeoutSec: 0,
      maxToolOutputBytes: 0,
    }[check.reason];
    await ctx.events.emit({
      type: "budget.exceeded",
      data: { reason: check.reason, limit: ctx.limits[check.reason], actual },
    });
    throw new Error(`budget: ${check.reason}`);
  }
}
export class ClaudeBrain implements Brain {
  constructor(
    private readonly client: MessagesClient,
    private readonly retryDelayMs = 500,
    private readonly systemPrompt = readFileSync(
      new URL("../../../prompts/system.md", import.meta.url),
      "utf8",
    ),
  ) {}
  async run(ctx: AgentContext): Promise<AgentOutcome> {
    const history: Anthropic.Beta.Messages.BetaMessageParam[] = [...ctx.history];
    if (history.length === 0) history.push({ role: "user", content: ctx.spec.task });
    const fallback = ctx.spec.refusalFallback && !ctx.spec.model.startsWith("claude-haiku-");
    let nudged = false;
    if (ctx.spec.refusalFallback && !fallback)
      await ctx.events.emit({
        type: "log",
        data: { level: "debug", message: "Refusal fallback is unsupported for Haiku; omitted." },
      });
    try {
      while (true) {
        await checkBudget(ctx);
        ctx.budget.recordTurn();
        const params: MessageRequest = {
          model: ctx.spec.model,
          max_tokens: 32000,
          thinking: { type: "adaptive" },
          output_config: { effort: ctx.spec.effort },
          cache_control: { type: "ephemeral" },
          system: this.systemPrompt.replaceAll("/workspace", ctx.sandbox.workspace ?? "/workspace"),
          messages: [...history],
          tools: ctx.tools.flatMap((tool) => (tool.modelDefinition ? [tool.modelDefinition] : [])),
          ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        };
        const message = await this.response(params, ctx.signal);
        history.push({ role: "assistant", content: message.content });
        const usage: Usage = {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
          costUsd: 0,
        };
        usage.costUsd = costUsd(message.model, usage);
        ctx.budget.recordUsage(usage);
        await ctx.events.emit({
          type: "model.response",
          data: { messageId: message.id, model: message.model, usage },
        });
        await checkBudget(ctx);
        if (message.stop_reason === "max_tokens")
          return { status: "failed", summary: "", failureReason: "max_tokens: truncated response" };
        if (message.stop_reason === "refusal")
          return {
            status: "failed",
            summary: "",
            failureReason: `refusal: ${message.stop_details?.category ?? "unknown"}`,
          };
        if (message.stop_reason === "pause_turn") continue;
        if (message.stop_reason === "end_turn") {
          if (nudged)
            return { status: "failed", summary: "", failureReason: "No submit after reminder" };
          history.push({
            role: "user",
            content: "Please finish the task and call submit with the requested deliverable.",
          });
          nudged = true;
          continue;
        }
        if (message.stop_reason !== "tool_use")
          return {
            status: "failed",
            summary: "",
            failureReason: `Unexpected stop reason: ${message.stop_reason}`,
          };
        const calls = message.content.filter((block) => block.type === "tool_use");
        if (calls.length === 0) throw new Error("tool_use response has no tool calls");
        const results: Anthropic.ToolResultBlockParam[] = [];
        let submitted: string | undefined;
        for (const call of calls) {
          await checkBudget(ctx);
          const started = performance.now();
          const tool = ctx.tools.find((candidate) => candidate.name === call.name);
          ctx.budget.recordToolCall();
          await ctx.events.emit({
            type: "tool.call",
            data: {
              toolCallId: call.id,
              name: call.name,
              risk: tool?.risk ?? "external",
              input: JSON.parse(JSON.stringify(call.input)),
            },
          });
          let output: string;
          let isError = false;
          try {
            if (submitted !== undefined)
              throw new Error("Run already submitted; subsequent tools were not executed");
            if (!tool) throw new Error("Unknown tool");
            const parsed = tool.inputSchema.safeParse(call.input);
            if (!parsed.success) {
              const fields = parsed.error.issues.map(
                (i) => `${i.path.join(".") || "input"}: ${i.message}`,
              );
              throw new Error(`Invalid tool input (${fields.join("; ")})`);
            }
            output = await tool.run(parsed.data, {
              runId: ctx.spec.id,
              sandbox: ctx.sandbox,
              limits: ctx.limits,
              budget: ctx.budget,
              events: ctx.events,
              signal: ctx.signal,
            });
            if (call.name === "submit") submitted = output;
          } catch (error) {
            isError = true;
            output = error instanceof Error ? error.message : "Tool failed";
          }
          const capped = capOutput(output, ctx.limits.maxToolOutputBytes);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: capped.text,
            is_error: isError,
          });
          await ctx.events.emit({
            type: "tool.result",
            data: {
              toolCallId: call.id,
              output: capped.text,
              isError,
              truncated: capped.truncated || output.includes("[truncated]"),
              durationMs: performance.now() - started,
            },
          });
          await checkBudget(ctx);
        }
        history.push({ role: "user", content: results });
        if (submitted !== undefined) return { status: "submitted", summary: submitted };
      }
    } catch (error) {
      return {
        status: ctx.signal.aborted ? "canceled" : "failed",
        summary: "",
        failureReason:
          error instanceof Anthropic.APIError
            ? `model API error: ${error.status ?? "connection"}`
            : error instanceof Error
              ? error.message
              : "Brain failed",
      };
    }
  }
  private async response(
    params: MessageRequest,
    signal: AbortSignal,
  ): Promise<Anthropic.Beta.Messages.BetaMessage> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        return await this.client.stream(params, { signal }).finalMessage();
      } catch (error) {
        const retryable =
          error instanceof Anthropic.RateLimitError ||
          error instanceof Anthropic.InternalServerError ||
          error instanceof Anthropic.APIConnectionError ||
          error instanceof SyntaxError;
        if (!retryable || attempt >= 1 || signal.aborted) throw error;
        await delay(this.retryDelayMs * 2 ** attempt, undefined, { signal });
      }
    }
  }
}
