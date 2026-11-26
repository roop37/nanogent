"use client";
import { Command } from "cmdk";
import {
  ChevronDown,
  Files,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  Square,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
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
import { authClient } from "@/lib/auth-client";
import { visiblePolling } from "@/lib/polling";
import { active, money, type RunView } from "@/lib/types";
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

type Allowance = { activeCount: number; charged: number };
type Config = { dailyCap: number; maxCost: number; models: string[]; environment: string };
const RunsContext = createContext<{
  runs: RunView[];
  clock: number;
  allowance: Allowance;
  connected: boolean;
}>({ runs: [], clock: 0, allowance: { activeCount: 0, charged: 0 }, connected: true });
export const useRuns = () => useContext(RunsContext);
export function Shell({
  children,
  initial,
  initialAllowance,
  initialTime,
  user,
  config,
}: {
  children: ReactNode;
  initial: RunView[];
  initialAllowance: Allowance;
  initialTime: number;
  user: { name: string; email: string };
  config: Config;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [runs, setRuns] = useState(initial);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(initialTime);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [width, setWidth] = useState(280);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [canceling, setCanceling] = useState(false);
  const dismiss = useCallback(() => setMessage(""), []);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const current = runs.find((r) => pathname === `/runs/${r.spec.id}`);
  const groups = groupRuns(runs, clock);
  const navigate = (href: string) => {
    setDrawer(false);
    setPalette(false);
    router.push(href);
  };
  useEffect(() => {
    try {
      setTabs(readTabs(sessionStorage.getItem("nanogent-tabs")));
    } catch {
      /* Storage may be disabled. */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || !pathname.startsWith("/runs/")) return;
    const title =
      pathname === "/runs/new"
        ? "New run"
        : (current?.spec.task ?? pathname.split("/").at(-1) ?? "Run");
    setTabs((prior) => tabReducer(prior, { type: "open", tab: { href: pathname, title } }));
  }, [pathname, current?.spec.task, hydrated]);
  useEffect(() => {
    if (hydrated) {
      try {
        sessionStorage.setItem("nanogent-tabs", JSON.stringify(tabs));
      } catch {
        /* Tabs still work without storage. */
      }
    }
  }, [tabs, hydrated]);
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
  }, [pathname]);
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
        router.push("/runs/new");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [router, palette, drawer]);
  async function signOut() {
    setPalette(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.assign("/sign-in");
    } catch {
      setMessage("Could not sign out. Try again.");
    }
  }
  async function cancel() {
    if (!current || canceling) return;
    setCanceling(true);
    setPalette(false);
    try {
      const response = await fetch(`/api/runs/${current.spec.id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error();
      setMessage("Cancellation requested");
      setRuns((prior) =>
        prior.map((r) => (r.spec.id === current.spec.id ? { ...r, cancelRequested: true } : r)),
      );
      router.refresh();
    } catch {
      setMessage("Could not cancel the run. Try again.");
    }
    setCanceling(false);
  }
  function closeTab(tab: EditorTab) {
    setTabs((prior) => tabReducer(prior, { type: "close", href: tab.href }));
    if (pathname === tab.href) router.push(closeDestination(tabs, tab.href));
  }
  const commands = [
    { label: "New run", hint: "N", icon: Plus, action: () => navigate("/runs/new") },
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
    ...(current && active(current.state) && !current.cancelRequested && !canceling
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
        <div className="px-3 pb-4">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate("/runs/new")}
          >
            <Plus />
            New run<Kbd>N</Kbd>
          </Button>
        </div>
        <nav
          aria-label="Run explorer"
          className="sidebar-scroll"
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            const links = Array.from(
              event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-run]"),
            );
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
          {runs.length === 0 ? (
            <div className="px-4 text-muted-foreground">
              <p className="mb-3">Your runs will appear here.</p>
              <Button variant="ghost" onClick={() => navigate("/runs/new")}>
                New run
              </Button>
            </div>
          ) : (
            <>
              {renderGroup("Active", groups.active)}
              <p className="px-4 pt-5 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                History
              </p>
              {renderGroup("Today", groups.today)}
              {renderGroup("Earlier", groups.earlier)}
            </>
          )}
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
    if (!list.length && title !== "Active") return null;
    return (
      <section aria-label={title}>
        <h2 className="flex h-7 items-center gap-1 px-3 text-[11px] text-muted-foreground">
          <ChevronDown size={12} />
          {title}
          <span className="ml-auto font-mono">{list.length}</span>
        </h2>
        {!list.length && <p className="px-5 py-2 text-xs text-muted-foreground">No active runs</p>}
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
      </section>
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
    <RunsContext.Provider value={{ runs, clock, allowance, connected }}>
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
              <option value={pathname}>{current?.spec.task ?? "New run"}</option>
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
                href="/runs/new"
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
                const run = runs.find((r) => `/runs/${r.spec.id}` === tab.href);
                return (
                  <div className="editor-tab" data-active={pathname === tab.href} key={tab.href}>
                    {run ? <StatusDot state={run.state} /> : <Plus size={14} />}
                    <Link href={tab.href} className="min-w-0 flex-1 truncate" title={tab.title}>
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
            {connected ? "Connected" : "Reconnecting"}
          </span>
          <span className="desktop-status">{allowance.activeCount} active</span>
          <span className="desktop-status ml-auto" />
          <Popover
            trigger={
              <button type="button" className="font-mono">
                ${allowance.charged.toFixed(2)} / ${config.dailyCap.toFixed(2)} today
              </button>
            }
          >
            <p className="mb-2 font-medium">Daily allowance</p>
            <p className="text-xs text-muted-foreground">
              Spent and reserved: {money(allowance.charged)}
              <br />
              Daily cap: {money(config.dailyCap)}
              <br />
              Per run: {money(config.maxCost)}
              <br />
              Up to 3 active runs. Resets at midnight UTC.
            </p>
          </Popover>
          <span className="desktop-status font-mono">{config.models[0]}</span>
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
      <Dialog
        open={palette}
        onOpenChange={(open) => {
          setPalette(open);
          if (!open) setQuery("");
        }}
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
      <Toast message={message} dismiss={dismiss} />
    </RunsContext.Provider>
  );
}
