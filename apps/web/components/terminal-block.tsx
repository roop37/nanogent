"use client";
import { Copy } from "lucide-react";
import { useState } from "react";
import { parseAnsi } from "@/lib/ansi";
export type Notify = (message: string) => void;
export async function copyText(text: string, notify: Notify, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    notify(label);
  } catch {
    notify("Could not copy. Check clipboard permissions and try again.");
  }
}
export function CopyButton({
  text,
  label,
  notify,
}: {
  text: string;
  label: string;
  notify: Notify;
}) {
  return (
    <button
      type="button"
      className="copy-button"
      aria-label={label}
      title={label}
      onClick={() => void copyText(text, notify, label.replace("Copy", "Copied"))}
    >
      <Copy size={13} />
    </button>
  );
}
export function TerminalBlock({
  text,
  command,
  error = false,
  truncated = false,
  running = false,
  notify,
}: {
  text: string;
  command?: string;
  error?: boolean | undefined;
  truncated?: boolean | undefined;
  running?: boolean;
  notify: Notify;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const visible = expanded ? text : lines.slice(0, 12).join("\n");
  return (
    <div className={`terminal-block ${error ? "terminal-error" : ""}`}>
      <div className="terminal-command">
        <pre>{command ?? "Output"}</pre>
        <CopyButton
          text={command ? `${command}\n${text}` : text}
          label="Copy block"
          notify={notify}
        />
      </div>
      {(text || running) && (
        <pre className="terminal-output">
          {parseAnsi(visible).map((span) => (
            <span
              key={span.offset}
              style={{
                color: error ? "var(--error)" : span.color,
                fontWeight: span.bold ? 600 : undefined,
              }}
            >
              {span.text}
            </span>
          ))}
          {running && (
            <output className="terminal-cursor" aria-label="Working">
              ▍
            </output>
          )}
        </pre>
      )}
      {lines.length > 12 && (
        <button
          type="button"
          className="text-link px-3 py-2 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {truncated && (
        <p className="px-3 pb-2 text-xs text-warning">Output truncated by the run limit.</p>
      )}
    </div>
  );
}
