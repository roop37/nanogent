export type DiffLine = {
  kind: "context" | "add" | "delete" | "marker";
  text: string;
  old?: number;
  new?: number;
  index: number;
};
export type Hunk = { header: string; lines: DiffLine[] };
export type DiffFile = {
  path: string;
  oldPath: string;
  status: "M" | "A" | "D" | "R";
  added: number;
  deleted: number;
  binary: boolean;
  hunks: Hunk[];
  patch: string;
};

function pathName(raw: string, stripPrefix = true) {
  let value = raw.split("\t")[0] ?? raw;
  if (value.startsWith('"') && value.endsWith('"')) {
    const encoder = new TextEncoder();
    const escapes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92,
    };
    const bytes = [...value.slice(1, -1).matchAll(/\\([0-7]{3}|.)|[^\\]+/gs)].flatMap(
      ([part, escaped]) => {
        if (!escaped) return [...encoder.encode(part)];
        if (/^[0-7]{3}$/.test(escaped)) return [Number.parseInt(escaped, 8)];
        return [escapes[escaped] ?? escaped.charCodeAt(0)];
      },
    );
    value = new TextDecoder().decode(Uint8Array.from(bytes));
  }
  return stripPrefix ? value.replace(/^[ab]\//, "") : value;
}
export function parseDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: Hunk | undefined;
  let old = 0;
  let next = 0;
  let remainingOld = 0;
  let remainingNew = 0;
  const chunks = patch.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const header = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/;
  let gitPatch = false;
  for (const [index, chunk] of chunks.entries()) {
    const line = chunk.replace(/\r?\n$/, "");
    const paths = header.exec(line);
    if (paths) gitPatch = true;
    const unifiedHeader =
      !gitPatch &&
      remainingOld === 0 &&
      remainingNew === 0 &&
      line.startsWith("--- ") &&
      chunks[index + 1]?.startsWith("+++ ");
    if (paths || unifiedHeader) {
      const oldPath = pathName(paths?.[1] ?? line.slice(4));
      file = {
        path: paths?.[2] ? pathName(paths[2]) : oldPath,
        oldPath,
        status: oldPath === "/dev/null" ? "A" : "M",
        added: 0,
        deleted: 0,
        binary: false,
        hunks: [],
        patch: chunk,
      };
      files.push(file);
      hunk = undefined;
      remainingOld = 0;
      remainingNew = 0;
      continue;
    }
    if (!file) continue;
    file.patch += chunk;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      old = Number(match[1]);
      next = Number(match[3]);
      remainingOld = Number(match[2] ?? 1);
      remainingNew = Number(match[4] ?? 1);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (hunk && line.startsWith("\\ No newline")) {
      hunk.lines.push({ kind: "marker", text: line, index });
      continue;
    }
    if (hunk && (remainingOld > 0 || remainingNew > 0)) {
      if (line.startsWith("+")) {
        hunk.lines.push({ kind: "add", text: line.slice(1), new: next++, index });
        file.added++;
        remainingNew--;
      } else if (line.startsWith("-")) {
        hunk.lines.push({ kind: "delete", text: line.slice(1), old: old++, index });
        file.deleted++;
        remainingOld--;
      } else if (line.startsWith(" ")) {
        hunk.lines.push({ kind: "context", text: line.slice(1), old: old++, new: next++, index });
        remainingNew--;
        remainingOld--;
      }
      continue;
    }
    if (line.startsWith("new file mode")) file.status = "A";
    if (line.startsWith("deleted file mode")) file.status = "D";
    if (line.startsWith("rename from ")) {
      file.oldPath = pathName(line.slice(12), false);
      file.status = "R";
    }
    if (line.startsWith("rename to ")) {
      file.path = pathName(line.slice(10), false);
      file.status = "R";
    }
    if (line.startsWith("--- ")) {
      const path = pathName(line.slice(4));
      if (path === "/dev/null") file.status = "A";
      else file.oldPath = path;
    }
    if (line.startsWith("+++ ")) {
      const path = pathName(line.slice(4));
      if (path === "/dev/null") {
        file.status = "D";
        file.path = file.oldPath;
      } else file.path = path;
    }
    if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
  }
  return files;
}
export type FileNode = { name: string; path: string; file?: number; children: FileNode[] };
export function buildFileTree(files: DiffFile[]): FileNode[] {
  const roots: FileNode[] = [];
  files.forEach((file, index) => {
    let nodes = roots;
    const parts = file.path.split("/");
    parts.forEach((name, depth) => {
      const path = parts.slice(0, depth + 1).join("/");
      const leaf = depth === parts.length - 1;
      let node = leaf ? undefined : nodes.find((n) => n.path === path && n.file === undefined);
      if (!node) {
        node = { name, path, children: [], ...(leaf ? { file: index } : {}) };
        nodes.push(node);
      }
      nodes = node.children;
    });
  });
  return roots;
}
export type DiffRow = { left?: DiffLine; right?: DiffLine };
export function splitRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line) break;
    if (line.kind === "context" || line.kind === "marker") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[i]?.kind === "delete") removed.push(lines[i++] as DiffLine);
    while (lines[i]?.kind === "add") added.push(lines[i++] as DiffLine);
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      rows.push({
        ...(removed[j] ? { left: removed[j] } : {}),
        ...(added[j] ? { right: added[j] } : {}),
      });
  }
  return rows;
}
export function changedRange(text: string, other: string): [number, number] {
  const a = text.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const b = other.match(/\w+|\s+|[^\w\s]/g) ?? [];
  let start = 0;
  let endA = a.length;
  let endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [a.slice(0, start).join("").length, a.slice(0, endA).join("").length];
}
