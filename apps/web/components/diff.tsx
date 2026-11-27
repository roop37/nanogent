"use client";
import { ChevronDown, ChevronRight, Download, FileCode, Folder } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFileTree,
  changedRange,
  type DiffFile,
  type DiffLine,
  type FileNode,
  parseDiff,
  splitRows,
} from "@/lib/diff";
import type { CodeToken } from "@/lib/highlight";
import { CopyButton, copyText, type Notify } from "./terminal-block";
import { Button } from "./ui/button";

function Code({
  line,
  other,
  tokens,
}: {
  line: DiffLine;
  other?: DiffLine | undefined;
  tokens?: CodeToken[] | undefined;
}) {
  const range = other && line.kind !== "context" ? changedRange(line.text, other.text) : undefined;
  return (
    <>
      {(tokens ?? [{ content: line.text, offset: 0 }]).map((token) => {
        const cuts = [
          ...new Set([
            0,
            ...(range ?? [])
              .map((n) => n - token.offset)
              .filter((n) => n > 0 && n < token.content.length),
            token.content.length,
          ]),
        ];
        return (
          <Fragment key={token.offset}>
            {cuts.slice(0, -1).map((start, i) => {
              const marked =
                range && start + token.offset >= range[0] && start + token.offset < range[1];
              return (
                <span
                  key={start}
                  style={{ color: token.color }}
                  className={marked ? "word-change" : undefined}
                >
                  {token.content.slice(start, cuts[i + 1])}
                </span>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
function FileDiff({
  file,
  index,
  collapsed,
  toggle,
  split,
  notify,
}: {
  file: DiffFile;
  index: number;
  collapsed: boolean;
  toggle: () => void;
  split: boolean;
  notify: Notify;
}) {
  const [rest, setRest] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<{
    lines: DiffLine[];
    tokens: Map<number, CodeToken[]>;
  }>();
  const lines = useMemo(() => file.hunks.flatMap((h) => h.lines), [file]);
  const tokens = highlight?.lines === lines ? highlight.tokens : undefined;
  const limit = rest ? lines.length : 2000;
  useEffect(() => {
    if (collapsed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void import("@/lib/highlight")
        .then((m) => m.highlightLines(file.path, lines.slice(0, limit), controller.signal))
        .then((value) => {
          if (!controller.signal.aborted) setHighlight({ lines, tokens: value });
        })
        .catch(() => {
          /* Plain text remains available if highlighting fails. */
        });
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [file.path, lines, limit, collapsed]);
  let rendered = 0;
  return (
    <section className="diff-file" id={`diff-file-${index}`} aria-label={file.path}>
      <div className="diff-file-header">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="truncate" title={file.path}>
            {file.path}
          </span>
        </button>
        <span className="diff-counts">
          <span className="text-success">+{file.added}</span>{" "}
          <span className="text-destructive">−{file.deleted}</span>
        </span>
        <CopyButton text={file.path} label="Copy path" notify={notify} />
        <CopyButton text={file.patch} label="Copy patch" notify={notify} />
      </div>
      {!collapsed && (
        <>
          {file.status === "R" && (
            <p className="p-3 text-muted-foreground">Renamed from {file.oldPath}</p>
          )}
          {file.binary && (
            <p className="p-3 text-muted-foreground">Binary file changed. Preview unavailable.</p>
          )}
          {!file.binary && file.hunks.length === 0 && (
            <p className="p-3 text-muted-foreground">File metadata changed. No text hunks.</p>
          )}
          <div className="diff-code" data-view={split ? "split" : "unified"}>
            {file.hunks.map((hunk, hi) => {
              const available = hunk.lines.slice(0, Math.max(0, limit - rendered));
              rendered += hunk.lines.length;
              if (!available.length) return null;
              const paired = splitRows(available);
              const peers = new Map<number, DiffLine>();
              for (const row of paired) {
                if (row.left && row.right && row.left !== row.right) {
                  peers.set(row.left.index, row.right);
                  peers.set(row.right.index, row.left);
                }
              }
              const rows = split
                ? paired
                : available.map((line) => ({ left: line, right: undefined }));
              const hidden = new Map<number, number>();
              if (!expanded.has(hi)) {
                for (let start = 0; start < rows.length; ) {
                  if (rows[start]?.left?.kind !== "context") {
                    start++;
                    continue;
                  }
                  let end = start + 1;
                  while (end < rows.length && rows[end]?.left?.kind === "context") end++;
                  if (end - start > 8) {
                    for (let i = start + 3; i < end - 3; i++)
                      hidden.set(i, i === start + 3 ? end - start - 6 : 0);
                  }
                  start = end;
                }
              }
              return (
                <Fragment key={hunk.lines[0]?.index ?? hunk.header}>
                  <div className="hunk-header">{hunk.header}</div>
                  {rows.map((row, ri) => {
                    const key = row.left?.index ?? row.right?.index ?? ri;
                    if (hidden.has(ri)) {
                      const count = hidden.get(ri);
                      if (!count) return null;
                      return (
                        <button
                          type="button"
                          className="context-expand"
                          key={key}
                          onClick={() => setExpanded((prior) => new Set([...prior, hi]))}
                        >
                          Expand {count} lines
                        </button>
                      );
                    }
                    const cell = (
                      line: DiffLine | undefined,
                      side?: "old" | "new",
                      other?: DiffLine,
                    ) => (
                      <div className={`diff-line ${line?.kind ?? "empty"}`}>
                        {(!side || side === "old") && (
                          <span className="line-number">{line?.old ?? ""}</span>
                        )}
                        {(!side || side === "new") && (
                          <span className="line-number">{line?.new ?? ""}</span>
                        )}
                        <span className="line-sign" aria-hidden="true">
                          {line?.kind === "add" ? "+" : line?.kind === "delete" ? "−" : " "}
                        </span>
                        <code>
                          {line && (
                            <Code line={line} other={other} tokens={tokens?.get(line.index)} />
                          )}
                        </code>
                      </div>
                    );
                    return split ? (
                      <div className="split-row" key={key}>
                        {cell(row.left, "old", row.right)}
                        {cell(row.right, "new", row.left)}
                      </div>
                    ) : (
                      <Fragment key={key}>
                        {row.left && cell(row.left, undefined, peers.get(row.left.index))}
                        {row.right &&
                          row.right !== row.left &&
                          cell(row.right, undefined, row.left)}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
          {!rest && lines.length > 2000 && (
            <button type="button" className="context-expand" onClick={() => setRest(true)}>
              Show rest ({lines.length - 2000} more lines)
            </button>
          )}
        </>
      )}
    </section>
  );
}
function Tree({
  nodes,
  files,
  select,
}: {
  nodes: FileNode[];
  files: DiffFile[];
  select: (index: number) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.file !== undefined ? (
          <button
            type="button"
            role="treeitem"
            key={fileKey(files[node.file])}
            className="file-tree-row"
            tabIndex={-1}
            onClick={() => select(node.file as number)}
          >
            <FileCode size={13} />
            <span className="truncate">{node.name}</span>
            <span className="ml-auto text-muted-foreground">{files[node.file]?.status}</span>
            <span className="text-success">+{files[node.file]?.added}</span>
            <span className="text-destructive">−{files[node.file]?.deleted}</span>
          </button>
        ) : (
          <Directory key={node.path} node={node} files={files} select={select} />
        ),
      )}
    </>
  );
}
function Directory({
  node,
  files,
  select,
}: {
  node: FileNode;
  files: DiffFile[];
  select: (index: number) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      role="treeitem"
      aria-label={node.name}
      aria-expanded={open}
      tabIndex={-1}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[role="treeitem"]') === e.currentTarget)
          setOpen(!open);
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setOpen(!open);
        }
      }}
    >
      <span className="file-tree-row">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Folder size={13} />
        {node.name}
      </span>
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: tree groups do not have form controls
        <div role="group" className="pl-4">
          <Tree nodes={node.children} files={files} select={select} />
        </div>
      )}
    </div>
  );
}
function fileKey(file: DiffFile | undefined) {
  return file && JSON.stringify([file.oldPath, file.path, file.status]);
}
export function Diff({ diff, notify }: { diff: string; notify: Notify }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [split, setSplit] = useState(false);
  const [wide, setWide] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const selected = useRef(0);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia("(min-width: 1100px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const select = (index: number) => {
    selected.current = Math.max(0, Math.min(files.length - 1, index));
    const header = root.current?.querySelector(
      `#diff-file-${selected.current} button`,
    ) as HTMLButtonElement | null;
    header?.scrollIntoView({ block: "nearest" });
    header?.focus({ preventScroll: true });
  };
  if (!diff) return <p className="p-4 text-muted-foreground">No changes recorded.</p>;
  return (
    <section
      aria-label="Diff"
      className="diff-viewer"
      ref={root}
      onKeyDown={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          (event.target instanceof HTMLElement && event.target.closest("input,textarea,select"))
        )
          return;
        if (event.key === "j" || event.key === "k") {
          event.preventDefault();
          select(selected.current + (event.key === "j" ? 1 : -1));
        }
        if (event.key === "[" || event.key === "]") {
          event.preventDefault();
          setCollapsed(event.key === "[" ? new Set(files.map((_, i) => i)) : new Set());
        }
      }}
    >
      <div className="diff-toolbar">
        <span className="text-xs text-muted-foreground">{files.length} changed files</span>
        <div className="ml-auto flex gap-1">
          <button type="button" aria-pressed={!split || !wide} onClick={() => setSplit(false)}>
            Unified
          </button>
          <button
            type="button"
            disabled={!wide}
            title={wide ? "Side by side" : "Split view needs a window at least 1100 px wide"}
            aria-pressed={split && wide}
            onClick={() => setSplit(true)}
          >
            Split
          </button>
        </div>
      </div>
      <div
        role="tree"
        tabIndex={0}
        onFocus={(event) => {
          if (event.target === event.currentTarget)
            event.currentTarget.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
        }}
        aria-label="Changed files"
        className="file-tree"
        onKeyDown={(event) => {
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
          );
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            items[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : Math.max(
                      0,
                      Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                    )
            ]?.focus();
          }
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            const item = items[index];
            const expanded = item?.getAttribute("aria-expanded");
            event.preventDefault();
            if (expanded === (event.key === "ArrowRight" ? "false" : "true")) {
              item?.click();
            } else if (event.key === "ArrowRight" && expanded === "true") {
              items[index + 1]?.focus();
            } else if (event.key === "ArrowLeft") {
              item?.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
            }
          }
        }}
      >
        <Tree nodes={tree} files={files} select={select} />
      </div>
      <div className="diff-files">
        {files.map((file, index) => (
          <FileDiff
            key={fileKey(file)}
            file={file}
            index={index}
            collapsed={collapsed.has(index)}
            toggle={() => {
              selected.current = index;
              setCollapsed((prior) => {
                const next = new Set(prior);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
              });
            }}
            split={split && wide}
            notify={notify}
          />
        ))}
        {!files.length && <TerminalFallback diff={diff} />}
      </div>
      <div className="diff-actions">
        <Button variant="ghost" onClick={() => void copyText(diff, notify, "Copied full patch")}>
          Copy full patch
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([diff], { type: "text/plain;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "nanogent.patch";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={13} />
          Download .patch
        </Button>
      </div>
    </section>
  );
}
function TerminalFallback({ diff }: { diff: string }) {
  return (
    <div className="p-4">
      <p className="mb-2 text-warning">Could not parse this patch. Raw patch:</p>
      <pre>{diff.slice(0, 100000)}</pre>
      {diff.length > 100000 && <p>Preview truncated. Download the full patch below.</p>}
    </div>
  );
}
