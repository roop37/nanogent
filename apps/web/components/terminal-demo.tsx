import { Check, GitBranch, Terminal } from "lucide-react";
export function TerminalDemo() {
  const lines = [
    ["text-muted-foreground", "$ nanogent run"],
    ["text-foreground", "Fix cursor pagination on the activity feed"],
    ["text-link", "› read  src/api/activity.ts"],
    ["text-link", "› bash  pnpm test activity"],
    ["text-destructive", "  FAIL  skips records with the same timestamp"],
    ["text-link", "› edit  src/api/activity.ts"],
    ["text-link", "› bash  pnpm test activity"],
    ["text-success", "  PASS  12 tests · 3 files"],
    ["text-success", "✓ verified  All checks passed"],
    ["text-muted-foreground", "  3 files changed  +42 −18"],
  ];
  return (
    <aside className="auth-demo" aria-hidden="true">
      <div className="max-w-lg">
        <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <GitBranch size={14} /> A workspace for the work in progress
        </p>
        <h2 className="text-3xl font-medium leading-tight tracking-tight">
          A task. A tested change.
          <br />
          <span className="text-muted-foreground">The whole story in between.</span>
        </h2>
        <div className="terminal-demo">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-xs text-muted-foreground">
            <Terminal size={14} /> activity-feed <span className="ml-auto">run / 0184</span>
          </div>
          <div className="space-y-3 p-5 font-mono text-xs">
            {lines.map(([color, line], i) => (
              <div
                key={line}
                className={`terminal-line ${color}`}
                style={{ "--delay": `${i * 0.6}s` } as React.CSSProperties}
              >
                {line}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <Check size={13} className="text-success" /> Change ready for review{" "}
            <span className="ml-auto font-mono">$0.04</span>
          </div>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Watch the commands. Check the tests. Review the diff.
        </p>
      </div>
    </aside>
  );
}
