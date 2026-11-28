"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProjectPin } from "@/lib/projects";
import { Button } from "./ui/button";
import { Select } from "./ui/primitives";

export function ProjectBranches({ id, pin }: { id: string; pin: ProjectPin }) {
  const router = useRouter();
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState(pin.branch);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, refresh] = useTransition();
  const [error, setError] = useState("");
  const endpoint = `/api/projects/${id}/branches`;
  const busy = pending || refreshing;

  async function loadBranches() {
    setPending(true);
    setError("");
    const next = page + 1;
    try {
      const response = await fetch(`${endpoint}?page=${next}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBranches((current) => [...new Set([pin.branch, ...current, ...data.branches])]);
      setPage(next);
      setHasMore(data.next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load branches.");
    } finally {
      setPending(false);
    }
  }

  async function saveBranch() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, expected: pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPage(0);
      setBranches([]);
      refresh(() => router.refresh());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the project branch.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {page === 0 ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={loadBranches}>
          {busy ? "Loading…" : "Change branch"}
        </Button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void saveBranch();
          }}
        >
          <label className="block text-sm font-medium" htmlFor="project-branch">
            Project branch
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="max-w-full"
              id="project-branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              disabled={busy}
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" disabled={busy}>
              Pin branch
            </Button>
            {hasMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={loadBranches}
              >
                Load more branches
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Pin the latest commit for file browsing and new sessions.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
