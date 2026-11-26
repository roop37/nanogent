import { z } from "zod";
import { active, type RunView } from "./types";
export function repoName(run: RunView) {
  return "url" in run.spec.repo
    ? run.spec.repo.url.replace(/^https:\/\/[^/]+\//, "").replace(/\.git$/, "")
    : "Local repository";
}
export function groupRuns(runs: RunView[], now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    active: runs.filter((r) => active(r.state)),
    today: runs.filter((r) => !active(r.state) && r.createdAt.slice(0, 10) === day),
    earlier: runs.filter((r) => !active(r.state) && r.createdAt.slice(0, 10) !== day),
  };
}
export function relativeTime(value: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
const TabSchema = z.object({
  href: z.string().regex(/^\/runs\/(?:new|run_[a-zA-Z0-9_]+)$/),
  title: z.string().max(12000),
});
export type EditorTab = z.infer<typeof TabSchema>;
export function readTabs(value: string | null): EditorTab[] {
  try {
    return z
      .array(TabSchema)
      .max(100)
      .parse(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
}
export function tabReducer(
  tabs: EditorTab[],
  action: { type: "open"; tab: EditorTab } | { type: "close"; href: string },
) {
  if (action.type === "close") return tabs.filter((tab) => tab.href !== action.href);
  const exists = tabs.some((tab) => tab.href === action.tab.href);
  return exists
    ? tabs.map((tab) => (tab.href === action.tab.href ? action.tab : tab))
    : [...tabs.slice(-99), action.tab];
}
export function closeDestination(tabs: EditorTab[], href: string) {
  const index = tabs.findIndex((tab) => tab.href === href);
  return tabs[index + 1]?.href ?? tabs[index - 1]?.href ?? "/";
}
export function paletteMatch(text: string, query: string) {
  const haystack = text.toLowerCase();
  let index = 0;
  for (const letter of query.toLowerCase().trim()) {
    if (letter === " ") continue;
    const found = haystack.indexOf(letter, index);
    if (found < 0) return false;
    index = found + 1;
  }
  return true;
}
export function filterRuns(runs: RunView[], query: string) {
  return runs.filter((r) => paletteMatch(`${r.spec.task} ${repoName(r)} ${r.spec.id}`, query));
}
