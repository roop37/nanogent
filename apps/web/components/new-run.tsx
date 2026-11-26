"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-slate-600 hover:text-indigo-700">
        All runs
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">New run</h1>
      <p className="mb-8 mt-2 text-slate-600">Describe the change and how to check it.</p>
      <Card>
        <CardContent className="pt-6">
          <form
            className="space-y-6"
            onSubmit={async (event) => {
              event.preventDefault();
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
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="repoUrl">
                Public repository URL
              </label>
              <Input
                id="repoUrl"
                name="repoUrl"
                type="url"
                required
                maxLength={2048}
                placeholder="https://github.com/owner/repository"
              />
              <p className="mt-2 text-sm text-slate-500">
                HTTPS on GitHub, GitLab, or Bitbucket. Public repositories only.
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
                rows={5}
                placeholder="What should change? Include the behavior you expect."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="verifyCommand">
                Verify command <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Input
                id="verifyCommand"
                name="verifyCommand"
                maxLength={2000}
                placeholder="npm test"
              />
              <p className="mt-2 text-sm text-slate-500">
                Run after the work finishes. Without this, the result is unverified.
              </p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="setupCommands">
                Setup commands <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Textarea
                id="setupCommands"
                name="setupCommands"
                rows={3}
                maxLength={20010}
                placeholder="npm ci"
              />
              <p className="mt-2 text-sm text-slate-500">
                One command per line, up to 10. Runs before the task starts.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="model">
                  Model
                </label>
                <select
                  className="model-select h-10 w-full rounded-md border bg-white pl-3 pr-10 text-sm"
                  id="model"
                  name="model"
                  defaultValue={models.at(-1)}
                >
                  {models.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="maxCostUsd">
                  Max cost (USD)
                </label>
                <Input
                  id="maxCostUsd"
                  name="maxCostUsd"
                  type="number"
                  required
                  min={0.0001}
                  max={maxCost}
                  step="any"
                  defaultValue={Math.min(0.1, maxCost)}
                />
              </div>
            </div>
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              Up to 3 active runs. Daily budget: ${dailyCap} USD, including budgets reserved for
              active runs. Resets at midnight UTC.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 border-t pt-5">
              <Button asChild variant="ghost">
                <Link href="/">Back to runs</Link>
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Submitting…" : "Start run"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
