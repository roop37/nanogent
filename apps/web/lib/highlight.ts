import type { GrammarState } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { DiffLine } from "./diff";
export type CodeToken = { content: string; color?: string | undefined; offset: number };
const languages = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
};
type Language = keyof typeof languages;
const extensions: Record<string, Language> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  html: "html",
  py: "python",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sql: "sql",
  go: "go",
  rs: "rust",
};
const highlighter = createHighlighterCore({
  themes: [import("shiki/themes/dark-plus.mjs")],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
function idle() {
  return new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 16);
  });
}
export async function highlightLines(
  path: string,
  lines: DiffLine[],
  signal: AbortSignal,
): Promise<Map<number, CodeToken[]>> {
  const result = new Map<number, CodeToken[]>();
  const language = extensions[path.split(".").at(-1) ?? ""];
  if (!language) return result;
  const high = await highlighter;
  await high.loadLanguage(languages[language]());
  // Tokenize both sides so deletions cannot change the grammar state of additions.
  for (const side of ["old", "new"] as const) {
    let state: GrammarState | undefined;
    let previous = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i % 40 === 0) await idle();
      if (signal.aborted) return result;
      const line = lines[i];
      if (!line || line[side] === undefined) continue;
      if (line.text.length > 4000) {
        state = undefined;
        continue;
      }
      if (line[side] !== previous + 1) state = undefined;
      previous = line[side];
      const tokens = high.codeToTokensBase(line.text, {
        lang: language,
        theme: "dark-plus",
        ...(state ? { grammarState: state } : {}),
      });
      state = high.getLastGrammarState(tokens);
      let offset = 0;
      result.set(
        line.index,
        (tokens[0] ?? []).map((token) => {
          const item = { content: token.content, color: token.color, offset };
          offset += token.content.length;
          return item;
        }),
      );
    }
  }
  return result;
}
