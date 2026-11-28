"use client";
import type { RunEvent } from "@nanogent/core";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, type Layout, Panel, Separator } from "react-resizable-panels";
import { visiblePolling } from "@/lib/polling";
import { costLevel, mergeEvents } from "@/lib/timeline";
import {
  active,
  commandDuration,
  duration,
  type EventPage,
  modelName,
  money,
  type RunView,
} from "@/lib/types";
import { repoName } from "@/lib/workspace";
import { Status } from "./status";
import { CopyButton, copyText, type Notify, TerminalBlock } from "./terminal-block";
import { Timeline } from "./timeline";
import { Button } from "./ui/button";
import {
  Dialog,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toast,
} from "./ui/primitives";

const Diff = dynamic(() => import("./diff").then((module) => module.Diff), {
  loading: () => (
    <section className="p-4 space-y-3" aria-label="Loading changes">
      <Skeleton />
      <Skeleton className="h-64" />
    </section>
  ),
});
function verificationReason(run: RunView) {
  if (run.result?.verified) return "";
  if (run.result?.verify?.exitCode === 0)
    return run.result.failureReason ?? "The check passed before the run ended early.";
  if (run.result?.verify) return "The verification command failed.";
  if (run.state === "canceled") return "The run was canceled before verification.";
  if (!run.spec.verifyCommand) return "No verification command was configured.";
  if (active(run.state)) return "Waiting for the harness check.";
  return run.result?.failureReason || "No harness check was recorded.";
}
function Verification({
  run,
  events,
  notify,
}: {
  run: RunView;
  events: RunEvent[];
  notify: Notify;
}) {
  const event = events.findLast((e) => e.type === "verify.result");
  const verify = run.result?.verify ?? (event?.type === "verify.result" ? event.data : undefined);
  return (
    <section className="p-4 space-y-3" aria-label="Verification details">
      <p
        className={
          verify?.exitCode === 0
            ? "text-success"
            : verify
              ? "text-destructive"
              : "text-muted-foreground"
        }
      >
        {verify?.exitCode === 0
          ? "Verified by the harness"
          : verify
            ? "Verification failed"
            : verificationReason(run)}
      </p>
      {verify && (
        <p className="font-mono text-xs text-muted-foreground">
          {verify.exitCode === null ? "Timed out or interrupted" : `Exit ${verify.exitCode}`} ·{" "}
          {verify.durationMs === undefined
            ? "Duration not recorded"
            : commandDuration(verify.durationMs)}
        </p>
      )}
      {(verify || run.spec.verifyCommand) && (
        <TerminalBlock
          command={`$ ${verify?.command ?? run.spec.verifyCommand}`}
          text={verify?.output || (verify ? "No output." : "")}
          error={!!verify && verify.exitCode !== 0}
          notify={notify}
        />
      )}
    </section>
  );
}
function Events({
  events,
  notify,
  loaded,
}: {
  events: RunEvent[];
  notify: Notify;
  loaded: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(200);
  const filtered = events.filter((event) => !filter || event.type === filter);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-3 items-center">
        <Select
          aria-label="Filter events by type"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(200);
          }}
        >
          <option value="">All event types</option>
          {[...new Set(events.map((e) => e.type))].sort().map((type) => (
            <option key={type}>{type}</option>
          ))}
        </Select>
        <Button
          variant="ghost"
          onClick={() =>
            void copyText(JSON.stringify(filtered, null, 2), notify, "Copied events as JSON")
          }
        >
          Copy as JSON
        </Button>
        <span className="text-muted-foreground">{filtered.length} events</span>
      </div>
      {!loaded ? (
        <Skeleton className="h-24" />
      ) : !filtered.length ? (
        <p className="text-muted-foreground">No events match this filter.</p>
      ) : (
        <ol className="raw-events">
          {filtered.slice(0, limit).map((event) => (
            <li key={event.seq}>
              <details>
                <summary>
                  <span className="text-muted-foreground">
                    #{event.seq} · {new Date(event.ts).toISOString().slice(11, 19)}
                  </span>{" "}
                  {event.type}
                </summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
      {filtered.length > limit && (
        <Button variant="ghost" onClick={() => setLimit(limit + 200)}>
          Show next 200 events
        </Button>
      )}
    </div>
  );
}
export function LiveRun({
  initial,
  dispatchPending,
}: {
  initial: RunView;
  dispatchPending: boolean;
}) {
  const [run, setRun] = useState(initial);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<number>();
  const [canceling, setCanceling] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>();
  const [restored, setRestored] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const cursor = useRef(1);
  const dismiss = useCallback(() => setMessage(""), []);
  const id = initial.spec.id;
  const running = active(run.state);
  const verification = events.findLast((event) => event.type === "verify.result");
  const verified =
    run.result?.verified ??
    (verification?.type === "verify.result" && verification.data.exitCode === 0);
  const reason =
    !run.result && verification?.type === "verify.result" && verification.data.exitCode !== 0
      ? "The verification command failed."
      : verificationReason(run);
  const patch = run.result?.diff ?? run.diffSnapshot;
  const resultEvent = events.findLast((event) => event.type === "run.result");
  const summary = run.result?.summary ?? resultEvent?.data.summary;
  const writtenResult = run.state === "completed" && !patch && !!summary?.trim();
  const showDetails = !writtenResult || showActivity;
  const checkFailed =
    (run.result?.verify != null && run.result.verify.exitCode !== 0) ||
    (verification?.type === "verify.result" && verification.data.exitCode !== 0);
  const unverifiedLabel = checkFailed
    ? "Verification failed"
    : !run.spec.verifyCommand
      ? "No verification configured"
      : running
        ? "Verification pending"
        : "Not verified";
  const cost = costLevel(run.progress.costUsd, run.spec.limits.maxCostUsd);
  useEffect(() => {
    const online = () => setRetry((value) => value + 1);
    const offline = () => setError("You are offline. Reconnecting when the connection returns.");
    if (!navigator.onLine) offline();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 899px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    try {
      const stored = JSON.parse(localStorage.getItem("nanogent-run-panes") ?? "null");
      if (
        stored &&
        Number.isFinite(stored.activity) &&
        Number.isFinite(stored.changes) &&
        stored.activity >= 20 &&
        stored.changes >= 20 &&
        Math.abs(stored.activity + stored.changes - 100) < 1
      )
        setLayout(stored);
    } catch {
      /* Use equal panes when browser storage is unavailable. */
    }
    setRestored(true);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!running) return;
    setClock(Date.now());
    const timer = setInterval(() => {
      if (!document.hidden) setClock(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const open = () => {
      if (running && !canceling && !run.cancelRequested) setConfirm(true);
    };
    const key = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "." &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("nanogent-cancel", open);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("nanogent-cancel", open);
    };
  }, [running, canceling, run.cancelRequested]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts the poller
  useEffect(() => {
    async function get(path: string, signal: AbortSignal) {
      const response = await fetch(path, { cache: "no-store", signal });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        throw new Error("Sign in to continue.");
      }
      if (response.status === 404) throw new Error("Run not found.");
      if (!response.ok) throw new Error("Connection interrupted. Retrying shortly.");
      return response.json();
    }
    return visiblePolling(
      async (signal) => {
        const { run: latest }: { run: RunView } = await get(`/api/runs/${id}`, signal);
        const page: EventPage = await get(`/api/runs/${id}/events?from=${cursor.current}`, signal);
        if (signal.aborted) return null;
        setRun(latest);
        setError("");
        setLoaded(true);
        setEvents((prior) => mergeEvents(prior, page.events));
        cursor.current = page.nextSeq;
        return page.hasMore ? 0 : active(latest.state) ? 1500 : null;
      },
      (cause) => {
        const text = navigator.onLine
          ? cause instanceof Error
            ? cause.message
            : "Could not refresh run. Retrying shortly."
          : "You are offline. Reconnecting when the connection returns.";
        setError(text);
        setMessage(text);
        return 3000;
      },
    );
  }, [id, retry]);
  async function cancel() {
    setConfirm(false);
    setCanceling(true);
    try {
      const response = await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error();
      setRun((prior) => ({ ...prior, cancelRequested: true }));
      setMessage("Cancellation requested");
      setRetry((n) => n + 1);
    } catch {
      setMessage("Could not cancel the run. Try again.");
    } finally {
      setCanceling(false);
    }
  }
  const activity = (
    <Timeline
      events={events}
      started={run.createdAt}
      running={running}
      loaded={loaded}
      notify={setMessage}
    />
  );
  const changes = (
    <section className="changes-pane" aria-label="Changes">
      <h2 className="pane-title">Changes</h2>
      {patch ? (
        <Diff diff={patch} notify={setMessage} />
      ) : (
        <div className="pane-empty">
          <FileEmpty />
          <p>{running ? "Changes will appear when the run finishes." : "No changes recorded."}</p>
          <p className="text-xs">
            {running
              ? "Activity is available live as commands finish."
              : "You can review the session in Activity."}
          </p>
        </div>
      )}
    </section>
  );
  const verify = <Verification run={run} events={events} notify={setMessage} />;
  return (
    <div className="run-workspace">
      <header className="run-header">
        <div className="run-breadcrumb">
          <Link href="/" title="All runs">
            {repoName(run)}
          </Link>
          <span aria-hidden="true">›</span>
          <h1 title={run.spec.task}>{run.spec.task.split("\n")[0]}</h1>
        </div>
        <div className="run-header-controls">
          <span aria-live="polite" aria-atomic="true">
            <Status state={run.state} />
          </span>
          <span
            className={`verification-badge ${verified ? "text-success" : "text-muted-foreground"}`}
            title={verified ? "The harness check passed." : reason}
            aria-live="polite"
          >
            {verified ? (
              <>
                <Check size={14} />
                Verified
              </>
            ) : (
              unverifiedLabel
            )}
          </span>
          <span className="run-id" title={id}>
            {id.slice(-8)}
          </span>
          <CopyButton text={id} label="Copy run id" notify={setMessage} />
          {running && (
            <Button
              className="cancel-run"
              variant="outline"
              disabled={canceling || run.cancelRequested}
              title="Cancel run (⌘ / Ctrl .)"
              onClick={() => setConfirm(true)}
            >
              {canceling || run.cancelRequested ? "Cancellation requested" : "Cancel run"}
            </Button>
          )}
        </div>
        {!verified && run.spec.verifyCommand && !running && !checkFailed && (
          <p className="verification-reason">{reason}</p>
        )}
      </header>
      <dl className="run-metrics">
        <div>
          <dt>Elapsed</dt>
          <dd>{duration(run, clock)}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{run.progress.turns}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{run.progress.toolCalls}</dd>
        </div>
        <div className="cost-metric">
          <dt>Cost</dt>
          <dd>
            {money(run.progress.costUsd)}{" "}
            <span className="text-muted-foreground">/ {money(run.spec.limits.maxCostUsd)}</span>
          </dd>
          <div
            className={`cost-track ${cost.tone}`}
            role="progressbar"
            aria-label="Cost limit used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(cost.percent)}
          >
            <span style={{ width: `${cost.percent}%` }} />
          </div>
        </div>
        <div title={run.spec.model}>
          <dt>Model</dt>
          <dd>{modelName(run.spec.model)}</dd>
        </div>
      </dl>
      {dispatchPending && run.state === "queued" && (
        <output className="run-notice">
          Run saved. Waiting for the runner to confirm its start. Its budget remains reserved.
        </output>
      )}
      {error && (
        <div role="alert" className="run-notice text-warning">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => setRetry((n) => n + 1)}>
            Retry now
          </button>
        </div>
      )}
      {!running && !run.result && (
        <p className="run-notice">
          This run ended without a result. No verification or diff was recorded.
        </p>
      )}
      {summary?.trim() && (!writtenResult || !showActivity) && (
        <section
          className={`run-result ${writtenResult ? "run-result-primary" : ""}`}
          aria-label="Result"
        >
          <div className="pane-title">
            <h2>Result</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyText(summary, setMessage, "Copied result")}
            >
              Copy result
            </Button>
          </div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long results. */}
          <section className="run-result-text" tabIndex={0} aria-label="Result text">
            {summary}
          </section>
        </section>
      )}
      {writtenResult && (
        <div className="run-result-navigation">
          <Button variant="outline" size="sm" onClick={() => setShowActivity(!showActivity)}>
            {showActivity ? "Back to result" : "View activity"}
          </Button>
        </div>
      )}
      {showDetails && mobile && (
        <Tabs defaultValue="activity" className="mobile-run-tabs">
          <TabsList aria-label="Run areas">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
          </TabsList>
          <TabsContent value="activity">{activity}</TabsContent>
          <TabsContent value="changes">{changes}</TabsContent>
          <TabsContent value="verify" className="overflow-auto">
            {verify}
            <details className="border-t">
              <summary className="p-4">Events</summary>
              <Events events={events} loaded={loaded} notify={setMessage} />
            </details>
          </TabsContent>
        </Tabs>
      )}
      {showDetails && !mobile && (
        <>
          <div className="run-panes">
            <Group
              key={restored ? "restored" : "initial"}
              defaultLayout={patch ? layout : undefined}
              orientation="horizontal"
              onLayoutChanged={(value) => {
                if (!restored || !patch) return;
                try {
                  localStorage.setItem("nanogent-run-panes", JSON.stringify(value));
                } catch {
                  /* Resizing still works without storage. */
                }
              }}
            >
              <Panel id="activity" minSize="20%" defaultSize="45%">
                {activity}
              </Panel>
              {patch && (
                <>
                  <Separator className="pane-separator" aria-label="Resize activity and changes" />
                  <Panel id="changes" minSize="20%" defaultSize="55%">
                    {changes}
                  </Panel>
                </>
              )}
            </Group>
          </div>
          <Tabs
            defaultValue="verification"
            onValueChange={() => setPanelOpen(true)}
            className={`run-bottom-panel ${panelOpen ? "is-open" : ""}`}
          >
            <div className="panel-heading">
              <TabsList aria-label="Run panel">
                <TabsTrigger value="verification" onClick={() => setPanelOpen(true)}>
                  Verification
                </TabsTrigger>
                <TabsTrigger value="events" onClick={() => setPanelOpen(true)}>
                  Events
                </TabsTrigger>
              </TabsList>
              <button
                type="button"
                className="ml-auto px-3"
                aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen(!panelOpen)}
              >
                {panelOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            </div>
            {panelOpen && (
              <>
                <TabsContent value="verification">{verify}</TabsContent>
                <TabsContent value="events">
                  <Events events={events} loaded={loaded} notify={setMessage} />
                </TabsContent>
              </>
            )}
          </Tabs>
        </>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this run?"
        description="Stops work and releases the sandbox. Work already done remains in the activity history."
      >
        <div className="p-6">
          <h2 className="text-lg font-medium">Cancel this run?</h2>
          <p className="mt-3 text-muted-foreground">
            Stops work and releases the sandbox. Work already done remains in the activity history.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep running
            </Button>
            <Button onClick={() => void cancel()}>Confirm cancel</Button>
          </div>
        </div>
      </Dialog>
      <Toast message={message} dismiss={dismiss} />
    </div>
  );
}
function FileEmpty() {
  return (
    <span className="text-2xl font-mono text-muted-foreground" aria-hidden="true">
      ±
    </span>
  );
}
