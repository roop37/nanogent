"use client";
import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import type { RunView } from "@/lib/types";
import { repoName } from "@/lib/workspace";
import { StatusDot } from "./status";
import { Dialog, Kbd } from "./ui/primitives";
export function Palette({
  open,
  onOpenChange,
  query,
  setQuery,
  commands,
  matches,
  navigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  commands: { label: string; hint: string; icon: LucideIcon; action: () => void }[];
  matches: RunView[];
  navigate: (href: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search commands and runs. Use arrow keys and Enter to select."
    >
      <Command shouldFilter={false}>
        <Command.Input
          autoFocus
          aria-label="Search commands and runs"
          placeholder="Search commands, tasks, repositories…"
          value={query}
          onValueChange={setQuery}
        />
        <Command.List>
          <Command.Empty>No results found.</Command.Empty>
          <Command.Group heading="Commands">
            {commands.map((c) => (
              <Command.Item key={c.label} value={c.label} onSelect={c.action}>
                <c.icon size={15} />
                {c.label}
                {c.hint && (
                  <span className="ml-auto">
                    <Kbd>{c.hint}</Kbd>
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Go to run">
            {matches.map((run) => (
              <Command.Item
                key={run.spec.id}
                value={run.spec.id}
                onSelect={() => navigate(`/runs/${run.spec.id}`)}
              >
                <StatusDot state={run.state} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{run.spec.task}</span>
                  <span className="text-[11px] text-muted-foreground">{repoName(run)}</span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <output aria-live="polite">
            {commands.length + matches.length}{" "}
            {commands.length + matches.length === 1 ? "result" : "results"}
          </output>
          <span>
            <Kbd>↑ ↓</Kbd> navigate <Kbd>Enter</Kbd> open
          </span>
        </div>
      </Command>
    </Dialog>
  );
}
