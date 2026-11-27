"use client";
import { Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { modelName } from "@/lib/types";
import { ProviderIcon } from "./provider-icon";
import { useRuns } from "./shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Kbd } from "./ui/primitives";
import { Textarea } from "./ui/textarea";
export function NewRun({
  models,
  maxCost,
  dailyCap,
}: {
  models: string[];
  maxCost: number;
  dailyCap: number;
}) {
  const router = useRouter();
  const { allowance } = useRuns();
  const [task, setTask] = useState("");
  const [cost, setCost] = useState(Math.min(0.1, maxCost));
  const [repoError, setRepoError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="new-run-page">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!pending) event.currentTarget.requestSubmit();
          }
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          const form = new FormData(event.currentTarget);
          const verify = String(form.get("verifyCommand") ?? "").trim();
          try {
            const response = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repoUrl: form.get("repoUrl"),
                task: form.get("task"),
                model: form.get("model"),
                maxCostUsd: Number(form.get("maxCostUsd")),
                setupCommands: String(form.get("setupCommands") ?? "")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                ...(verify ? { verifyCommand: verify } : {}),
              }),
            });
            const data = await response.json();
            if (!response.ok) {
              setError(data.error ?? "Could not submit run.");
              setPending(false);
              return;
            }
            router.push(`/runs/${data.id}${data.warning ? "?dispatch=pending" : ""}`);
          } catch {
            setError("Connection failed. Check your runs before trying again.");
            setPending(false);
          }
        }}
      >
        <div className="new-run-scroll">
          <div className="mx-auto max-w-2xl space-y-6">
            <header>
              <Link href="/" className="text-sm text-muted-foreground hover:text-link">
                All runs
              </Link>
              <h1 className="mt-5 text-2xl font-medium tracking-tight">New run</h1>
              <p className="mt-2 text-muted-foreground">Describe the change and how to check it.</p>
            </header>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="repoUrl">
                Public repository URL
              </label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-muted-foreground">
                  <ProviderIcon provider="github" />
                </span>
                <Input
                  className="pl-9"
                  aria-invalid={!!repoError}
                  aria-describedby="repo-help"
                  onChange={(event) => {
                    let valid = true;
                    try {
                      const url = new URL(event.target.value);
                      valid =
                        url.protocol === "https:" &&
                        ["github.com", "gitlab.com", "bitbucket.org"].includes(url.hostname) &&
                        !url.username &&
                        !url.password &&
                        !url.port &&
                        !url.search &&
                        !url.hash &&
                        /^\/[\w.-]+(?:\/[\w.-]+)+\/?$/.test(url.pathname);
                    } catch {
                      valid = !event.target.value;
                    }
                    const message = valid
                      ? ""
                      : "Use a public HTTPS repository on GitHub, GitLab, or Bitbucket.";
                    event.target.setCustomValidity(message);
                    setRepoError(message);
                  }}
                  id="repoUrl"
                  name="repoUrl"
                  type="url"
                  required
                  maxLength={2048}
                  placeholder="https://github.com/owner/repository"
                />
              </div>
              <p
                id="repo-help"
                className={`mt-2 text-xs ${repoError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {repoError || "HTTPS on GitHub, GitLab, or Bitbucket. Public repositories only."}
              </p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="task">
                Task
              </label>
              <Textarea
                id="task"
                name="task"
                required
                maxLength={12000}
                rows={6}
                className="font-mono leading-6"
                value={task}
                onChange={(event) => {
                  setTask(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${event.target.scrollHeight}px`;
                }}
                placeholder="What should change? Include the behavior you expect."
              />
            </div>
            <p className="mt-2 text-right font-mono text-xs text-muted-foreground">
              {task.length.toLocaleString()} / 12,000
            </p>
            <details className="border-y py-4">
              <summary className="text-muted-foreground">
                Advanced <span className="ml-2 text-xs">Setup and verification</span>
              </summary>
              <div className="mt-5 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="verifyCommand">
                    Verify command{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="verifyCommand"
                    name="verifyCommand"
                    maxLength={2000}
                    placeholder="npm test"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Run after the work finishes. Without this, the result is unverified.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="setupCommands">
                    Setup commands{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Textarea
                    id="setupCommands"
                    name="setupCommands"
                    rows={3}
                    maxLength={20010}
                    placeholder="npm ci"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    One command per line, up to 10. Runs before the task starts.
                  </p>
                </div>
              </div>
            </details>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Model</p>
                <input type="hidden" name="model" value={models[0]} />
                <span
                  title={models[0]}
                  className="inline-flex rounded border px-3 py-2 font-mono text-xs"
                >
                  {modelName(models[0] ?? "")}
                </span>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="maxCostUsd">
                  Max cost (USD) <span className="float-right font-mono">${cost.toFixed(2)}</span>
                </label>
                <Input
                  id="maxCostUsd"
                  name="maxCostUsd"
                  type="range"
                  required
                  min={0.0001}
                  max={maxCost}
                  step={0.0001}
                  value={cost}
                  onChange={(event) => setCost(Number(event.target.value))}
                />
              </div>
            </div>
            <p className="rounded-md bg-panel p-3 text-sm text-muted-foreground">
              Up to 3 active runs. The daily limit is ${dailyCap.toFixed(2)} USD and resets at
              midnight UTC.{" "}
              {allowance && `$${allowance.charged.toFixed(2)} spent or reserved today.`}
            </p>
          </div>
        </div>
        <div className="new-run-actions">
          {error && (
            <p role="alert" className="mx-auto mb-3 max-w-2xl text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-end gap-x-3 gap-y-2">
            <Button asChild variant="ghost">
              <Link href="/">Back to runs</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              <Play size={14} />
              {pending ? "Submitting…" : "Start run"}
              <Kbd>⌘ / Ctrl Enter</Kbd>
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
