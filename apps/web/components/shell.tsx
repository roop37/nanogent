"use client";
import {
  ChevronDown,
  Files,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Search,
  Square,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { visiblePolling } from "@/lib/polling";
import type { Project } from "@/lib/projects";
import { active, modelName, money, type RunView } from "@/lib/types";
import {
  closeDestination,
  type EditorTab,
  filterRuns,
  groupRuns,
  paletteMatch,
  readTabs,
  relativeTime,
  repoName,
  tabReducer,
} from "@/lib/workspace";
import { StatusDot } from "./status";
import { Button } from "./ui/button";
import { Dialog, Kbd, Popover, Select, Toast, Tooltip } from "./ui/primitives";

const Palette = dynamic(() => import("./palette").then((m) => m.Palette));

type Allowance = { activeCount: number; charged: number };
type Config = { dailyCap: number; maxCost: number; defaultModel: string; environment: string };
const RunsContext = createContext<{
  runs: RunView[];
  clock: number;
  allowance: Allowance | null;
  connected: boolean;
  online: boolean;
  openEditor: (tab: EditorTab) => void;
}>({
  runs: [],
  clock: 0,
  allowance: null,
  connected: true,
  online: true,
  openEditor: () => {},
});
export const useRuns = () => useContext(RunsContext);
export function Shell({
  children,
  initial,
  initialAllowance,
  initialConnected,
  initialTime,
  projects,
  user,
  config,
}: {
  children: ReactNode;
  initial: RunView[];
  initialAllowance: Allowance | null;
  initialConnected: boolean;
  initialTime: number;
  projects: Pick<Project, "id" | "fullName">[] | null;
  user: { id: string; name: string; email: string };
  config: Config;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [runs, setRuns] = useState(initial);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [connected, setConnected] = useState(initialConnected);
  const [online, setOnline] = useState(true);
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(initialTime);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [width, setWidth] = useState(280);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const tabsKey = `nanogent-tabs:${user.id}`;
  const dismiss = useCallback(() => setMessage(""), []);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const current = runs.find((r) => pathname === `/runs/${r.spec.id}`);
  const [, currentProjectId, currentSessionId] =
    /^\/projects\/([^/]+)(?:\/sessions\/([^/]+))?$/.exec(pathname) ?? [];
  const currentProject = projects?.find((project) => project.id === currentProjectId);
  const runProjectId = currentProject?.id ?? current?.projectId;
  const sessionId = currentSessionId ?? current?.sessionId;
  const newRunHref = runProjectId
    ? `/runs/new?${new URLSearchParams({ project: runProjectId, ...(sessionId && { session: sessionId }) })}`
    : "/runs/new";
  const groups = groupRuns(runs, clock);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setRetry((value) => value + 1);
      else setConnected(false);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const navigate = (href: string) => {
    setDrawer(false);
    setPalette(false);
    router.push(href);
  };
  useEffect(() => {
    try {
      setTabs(readTabs(sessionStorage.getItem(tabsKey)));
    } catch {
      /* Storage may be disabled. */
    }
    setHydrated(true);
  }, [tabsKey]);
  const openEditor = useCallback(
    (tab: EditorTab) => {
      if (hydrated) setTabs((prior) => tabReducer(prior, { type: "open", tab }));
    },
    [hydrated],
  );
  useEffect(() => {
    if (!pathname.startsWith("/runs/")) return;
    const title =
      pathname === "/runs/new"
        ? "New run"
        : (current?.spec.task ?? pathname.split("/").at(-1) ?? "Run");
    openEditor({ href: pathname, title });
  }, [pathname, current?.spec.task, openEditor]);
  useEffect(() => {
    if (hydrated) {
      try {
        sessionStorage.setItem(tabsKey, JSON.stringify(tabs));
      } catch {
        /* Tabs still work without storage. */
      }
    }
  }, [tabs, hydrated, tabsKey]);
  // Refresh after navigation so a submitted run appears immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes trigger a refresh
  useEffect(() => {
    return visiblePolling(
      async (signal) => {
        const response = await fetch("/api/runs", { cache: "no-store", signal });
        if (response.status === 401) {
          window.location.assign("/sign-in");
          return null;
        }
        if (!response.ok) throw new Error();
        const data: { runs: RunView[]; allowance: Allowance } = await response.json();
        if (signal.aborted) return null;
        runsRef.current = data.runs;
        setRuns(data.runs);
        setAllowance(data.allowance);
        setConnected(true);
        setClock(Date.now());
        return data.runs.some((r) => active(r.state)) ? 5000 : 30000;
      },
      () => {
        setConnected(false);
        return runsRef.current.some((r) => active(r.state)) ? 5000 : 30000;
      },
    );
  }, [pathname, retry]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && runsRef.current.some((r) => active(r.state))) setClock(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          !!event.target.closest("input, textarea, select, [role=combobox]"));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((p) => !p);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (window.innerWidth < 900) setDrawer((p) => !p);
        else setCollapsed((p) => !p);
      } else if (
        !editing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key === "n" &&
        !palette &&
        !drawer &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        router.push(newRunHref);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [router, palette, drawer, newRunHref]);
  async function signOut() {
    setPalette(false);
    try {
      const { authClient } = await import("@/lib/auth-client");
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.assign("/sign-in");
    } catch {
      setMessage("Could not sign out. Try again.");
    }
  }
  function cancel() {
    setPalette(false);
    window.dispatchEvent(new Event("nanogent-cancel"));
  }
  function closeTab(tab: EditorTab) {
    setTabs((prior) => tabReducer(prior, { type: "close", href: tab.href }));
    if (pathname === tab.href) router.push(closeDestination(tabs, tab.href));
  }
  const commands = [
    { label: "New run", hint: "N", icon: Plus, action: () => navigate(newRunHref) },
    {
      label: "Toggle sidebar",
      hint: "⌘ / Ctrl B",
      icon: PanelLeftClose,
      action: () => {
        if (window.innerWidth < 900) setDrawer((p) => !p);
        else setCollapsed((p) => !p);
        setPalette(false);
      },
    },
    ...(current && active(current.state) && !current.cancelRequested
      ? [{ label: "Cancel current run", hint: "", icon: Square, action: cancel }]
      : []),
    { label: "Sign out", hint: "", icon: Terminal, action: signOut },
  ].filter((c) => paletteMatch(c.label, query));
  const matches = filterRuns(runs, query);
  function sidebar() {
    return (
      <>
        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <Link
            href="/"
            onClick={() => setDrawer(false)}
            className="text-[11px] font-medium tracking-widest"
          >
            RUNS
          </Link>
          <button
            type="button"
            aria-label="Collapse sidebar"
            className="hidden rounded p-1 hover:bg-accent min-[900px]:block"
            onClick={() => {
              setCollapsed(true);
              setDrawer(false);
            }}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        {projects && (
          <nav
            aria-label="Projects"
            className="mb-3 max-h-36 shrink-0 overflow-auto border-b px-3 pb-3"
          >
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <h2>Projects</h2>
              <Link
                prefetch={false}
                onClick={() => setDrawer(false)}
                href="/projects"
                className="flex items-center gap-1 rounded p-1 hover:bg-accent"
              >
                <Plus size={14} aria-hidden="true" /> Import projects
              </Link>
            </div>
            {projects.map((project) => (
              <Link
                prefetch={false}
                className="block truncate rounded px-2 py-1.5 hover:bg-accent aria-[current=page]:bg-selected"
                key={project.id}
                href={`/projects/${project.id}`}
                onClick={() => setDrawer(false)}
                aria-current={currentProject?.id === project.id ? "page" : undefined}
                title={project.fullName}
              >
                {project.fullName}
              </Link>
            ))}
          </nav>
        )}
        <div className="px-3 pb-4">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate(newRunHref)}
          >
            <Plus />
            New run<Kbd>N</Kbd>
          </Button>
        </div>
        {!connected && (
          <output className="px-4 py-2 text-warning text-xs">
            {online
              ? "Connection interrupted. Retrying shortly."
              : "You are offline. Reconnecting when the connection returns."}
            <button
              type="button"
              className="mt-1 block underline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry now
            </button>
          </output>
        )}
        <nav
          aria-label="Run explorer"
          className="sidebar-scroll"
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            const links = Array.from(
              event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-run]"),
            ).filter((link) => link.getClientRects().length > 0);
            const index = links.indexOf(document.activeElement as HTMLAnchorElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? links.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
            event.preventDefault();
            links[next]?.focus();
          }}
        >
          {runs.length === 0 && connected ? (
            <div className="px-4 text-muted-foreground">
              <p className="mb-3">Your runs will appear here.</p>
              <Button variant="ghost" onClick={() => navigate(newRunHref)}>
                New run
              </Button>
            </div>
          ) : runs.length > 0 ? (
            <>
              {renderGroup("Active", groups.active)}
              {renderGroup("Today", groups.today)}
              {renderGroup("Earlier", groups.earlier)}
            </>
          ) : null}
        </nav>
        <button
          type="button"
          className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => {
            setDrawer(false);
            setQuery("");
            setPalette(true);
          }}
        >
          <Search size={14} /> Find a run{" "}
          <span className="ml-auto">
            <Kbd>⌘ / Ctrl K</Kbd>
          </span>
        </button>
      </>
    );
  }
  function renderGroup(title: string, list: RunView[]) {
    return (
      <details aria-label={title} open>
        <summary className="flex h-7 items-center gap-1 px-3 text-[11px] text-muted-foreground">
          <ChevronDown size={12} />
          {title}
          <span className="ml-auto font-mono">{list.length}</span>
        </summary>
        {!list.length && <p className="px-5 py-2 text-xs text-muted-foreground">No runs</p>}
        {list.map((run) => (
          <Link
            data-run
            key={run.spec.id}
            href={`/runs/${run.spec.id}`}
            className="run-row"
            aria-current={pathname === `/runs/${run.spec.id}` ? "page" : undefined}
            onClick={() => setDrawer(false)}
            title={`${run.spec.task}\n${run.state === "awaiting_approval" ? "blocked" : run.state}`}
          >
            <span className="pt-1">
              <StatusDot state={run.state} />
            </span>
            <div className="min-w-0">
              <div className="run-row-title">{run.spec.task.split("\n")[0]}</div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{repoName(run)}</span>
                <time className="ml-auto shrink-0" dateTime={run.createdAt}>
                  {relativeTime(run.createdAt, clock)}
                </time>
                <span className="shrink-0 font-mono">{money(run.progress.costUsd)}</span>
              </div>
              <span className="sr-only">
                {run.state === "awaiting_approval" ? "blocked" : run.state}
              </span>
            </div>
          </Link>
        ))}
      </details>
    );
  }
  const account = (
    <Popover
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          className="grid size-8 place-items-center rounded-full border border-input bg-selected text-xs"
        >
          {user.name.slice(0, 2).toUpperCase()}
        </button>
      }
    >
      <p className="font-medium">{user.name}</p>
      <p className="mb-3 text-xs text-muted-foreground">{user.email}</p>
      <Button variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </Popover>
  );
  return (
    <RunsContext.Provider value={{ runs, clock, allowance, connected, online, openEditor }}>
      <div className="workspace">
        <header className="mobile-topbar">
          <button type="button" aria-label="Open runs menu" onClick={() => setDrawer(true)}>
            <Menu size={20} />
          </button>
          <Select
            aria-label="Switch editor tab"
            className="min-w-0 flex-1 border-0 bg-transparent"
            value={pathname}
            onChange={(e) => navigate(e.target.value)}
          >
            <option value="/">Recent runs</option>
            {!tabs.some((t) => t.href === pathname) && pathname !== "/" && (
              <option value={pathname}>
                {current?.spec.task ??
                  currentProject?.fullName ??
                  (pathname === "/projects" ? "Projects" : "New run")}
              </option>
            )}
            {tabs.map((tab) => (
              <option key={tab.href} value={tab.href}>
                {tab.title}
              </option>
            ))}
          </Select>
          {pathname !== "/" && (
            <button
              type="button"
              aria-label="Close current tab"
              onClick={() => closeTab({ href: pathname, title: "" })}
            >
              <X size={15} />
            </button>
          )}
          <button
            type="button"
            aria-label="Open command palette"
            onClick={() => {
              setQuery("");
              setPalette(true);
            }}
          >
            <Search size={18} />
          </button>
          {account}
        </header>
        <div className="workspace-body">
          <aside className="activity-bar">
            <Link
              href="/"
              className="grid h-12 place-items-center text-link"
              aria-label="Nanogent home"
            >
              <Terminal size={22} />
            </Link>
            <Tooltip label="Runs (⌘ / Ctrl B)">
              <Link
                href="/"
                aria-label="Runs"
                onClick={() => setCollapsed(false)}
                className="activity-item"
                data-active={pathname !== "/runs/new"}
              >
                <Files size={23} />
              </Link>
            </Tooltip>
            <Tooltip label="New run (N)">
              <Link
                href={newRunHref}
                aria-label="New run"
                className="activity-item"
                data-active={pathname === "/runs/new"}
              >
                <Plus size={23} />
              </Link>
            </Tooltip>
            <Tooltip label="Command palette (⌘ / Ctrl K)">
              <button
                type="button"
                aria-label="Open command palette"
                className="activity-item"
                onClick={() => {
                  setQuery("");
                  setPalette(true);
                }}
              >
                <Search size={21} />
              </button>
            </Tooltip>
            <div className="mt-auto pb-3">{account}</div>
          </aside>
          {!collapsed && (
            <aside className="sidebar" style={{ "--sidebar-width": `${width}px` } as CSSProperties}>
              {sidebar()}
              <hr
                aria-label="Resize sidebar"
                aria-orientation="vertical"
                aria-valuemin={220}
                aria-valuemax={420}
                aria-valuenow={width}
                tabIndex={0}
                className="resize-handle"
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    setWidth((w) =>
                      Math.max(220, Math.min(420, w + (e.key === "ArrowRight" ? 10 : -10))),
                    );
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    setWidth(Math.max(220, Math.min(420, e.clientX - 48)));
                }}
                onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
              />
            </aside>
          )}
          <div className="editor">
            <nav className="editor-tabs" aria-label="Open editors">
              <Link href="/" className="editor-tab" data-active={pathname === "/"}>
                <Files size={14} />
                Overview
              </Link>
              {tabs.map((tab) => {
                const isSession = tab.href.startsWith("/projects/");
                const run = runs.find((r) =>
                  isSession
                    ? !!r.sessionId &&
                      `/projects/${r.projectId}/sessions/${r.sessionId}` === tab.href
                    : `/runs/${r.spec.id}` === tab.href,
                );
                return (
                  <div className="editor-tab" data-active={pathname === tab.href} key={tab.href}>
                    {run ? (
                      <StatusDot state={run.state} />
                    ) : isSession ? (
                      <MessagesSquare size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    <Link
                      href={tab.href}
                      prefetch={isSession ? false : null}
                      className="min-w-0 flex-1 truncate"
                      title={tab.title}
                    >
                      {tab.title}
                    </Link>
                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      className="rounded p-0.5 hover:bg-accent"
                      onClick={() => closeTab(tab)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </nav>
            <main className="editor-pane">{children}</main>
          </div>
        </div>
        <footer className="status-bar">
          <span className="desktop-status">{user.name}</span>
          <span
            className="flex items-center gap-1.5"
            title={connected ? "Last sync succeeded" : "Retrying connection"}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? "Connected" : online ? "Reconnecting" : "Offline"}
          </span>
          {allowance && <span className="desktop-status">{allowance.activeCount} active</span>}
          <span className="desktop-status ml-auto" />
          <Popover
            trigger={
              <button type="button" className="font-mono">
                {allowance
                  ? `$${allowance.charged.toFixed(2)} / $${config.dailyCap.toFixed(2)} today`
                  : "Allowance unavailable"}
              </button>
            }
          >
            <p className="mb-2 font-medium">Daily allowance</p>
            <p className="text-xs text-muted-foreground">
              Spent and reserved: {allowance ? money(allowance.charged) : "—"}
              <br />
              Daily cap: {money(config.dailyCap)}
              <br />
              Per run: {money(config.maxCost)}
              <br />
              Up to 3 active runs. Resets at midnight UTC.
            </p>
          </Popover>
          <span
            title={`Default model: ${config.defaultModel}`}
            className="desktop-status font-mono"
          >
            {modelName(config.defaultModel)}
          </span>
          <span className="desktop-status">{config.environment}</span>
        </footer>
      </div>
      <Dialog
        open={drawer}
        onOpenChange={setDrawer}
        title="Runs"
        description="Browse active runs and history"
        className="drawer"
      >
        {sidebar()}
      </Dialog>
      {palette && (
        <Palette
          open={palette}
          onOpenChange={(open) => {
            setPalette(open);
            if (!open) setQuery("");
          }}
          query={query}
          setQuery={setQuery}
          commands={commands}
          matches={matches}
          navigate={navigate}
        />
      )}
      <Toast message={message} dismiss={dismiss} />
    </RunsContext.Provider>
  );
}
