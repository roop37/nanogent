import { randomUUID } from "node:crypto";
import {
  capOutput,
  type PermissionPolicy as PolicySpec,
  permissionFor,
  type Tool,
  type ToolContext,
  type ToolRisk,
} from "@nanogent/core";

export type Approver = (
  request: { approvalId: string; toolCallId: string; name: string; risk: ToolRisk },
  signal: AbortSignal,
) => Promise<"allow" | "deny">;
export class PermissionPolicy {
  constructor(private readonly spec: PolicySpec) {}
  decide(tool: Pick<Tool, "name" | "risk">) {
    return permissionFor(this.spec, tool);
  }
}
export class ToolRegistry {
  readonly #tools = new Map<string, Tool>();
  constructor(
    tools: readonly Tool[],
    private readonly policy: PermissionPolicy,
    private readonly approve?: Approver,
  ) {
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      this.#tools.set(tool.name, tool);
    }
  }
  tools(ctx: ToolContext): Tool[] {
    return [...this.#tools.values()].map((tool) => ({
      ...tool,
      run: (input) => this.execute(tool.name, input, ctx),
    }));
  }
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<string> {
    ctx.signal.throwIfAborted();
    const tool = this.#tools.get(name);
    if (!tool) throw new Error("Unknown tool");
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid tool input");
    const risk =
      name === "str_replace_based_edit_tool" &&
      typeof input === "object" &&
      input !== null &&
      "command" in input &&
      input.command === "view"
        ? "read"
        : tool.risk;
    let decision = this.policy.decide({ name, risk });
    await ctx.events.emit({
      type: "log",
      data: { level: "debug", message: `policy ${name} ${risk}: ${decision}` },
    });
    if (decision === "ask") {
      const request = { approvalId: randomUUID(), toolCallId: randomUUID(), name, risk };
      decision = this.approve ? await this.approve(request, ctx.signal) : "deny";
    }
    if (decision !== "allow") throw new Error(`Permission denied: ${name}`);
    ctx.signal.throwIfAborted();
    const check = ctx.budget.check();
    if (!check.ok) throw new Error(`Budget exceeded: ${check.reason}`);
    return capOutput(await tool.run(parsed.data, ctx), ctx.limits.maxToolOutputBytes).text;
  }
}
