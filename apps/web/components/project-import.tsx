"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ProjectImport({
  installation,
  repositories,
  imported,
}: {
  installation: string;
  repositories: { id: string; full_name: string; private: boolean; default_branch: string }[];
  imported: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const matches = repositories.filter((repo) =>
    repo.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || !selected.length) return;
        setPending(true);
        setError("");
        setMessage("");
        try {
          const response = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ installationId: installation, repositories: selected }),
          });
          const data = await response.json();
          if (!response.ok) {
            setError(data.error ?? "Could not import projects.");
            return;
          }
          setMessage(`${data.imported} ${data.imported === 1 ? "project" : "projects"} imported.`);
          setSelected([]);
          router.refresh();
        } catch {
          setError("Could not import projects. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <Input
        aria-label="Filter repositories on this page"
        placeholder="Filter repositories on this page"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <fieldset className="rounded border divide-y divide-border">
        <legend className="sr-only">Repositories to import</legend>
        {matches.length ? (
          matches.map((repo) => {
            const exists = imported.includes(repo.id);
            const checked = selected.includes(repo.id);
            return (
              <label key={repo.id} className="flex items-center gap-3 p-3 hover:bg-accent">
                <input
                  type="checkbox"
                  checked={checked || exists}
                  disabled={exists || pending || (!checked && selected.length >= 10)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, repo.id]
                        : selected.filter((id) => id !== repo.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{repo.full_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {repo.default_branch} · {repo.private ? "Private" : "Public"}
                  </span>
                </span>
                {exists && <span className="text-xs text-muted-foreground">Imported</span>}
              </label>
            );
          })
        ) : (
          <p className="p-3 text-muted-foreground">No repositories match.</p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!selected.length || pending}>
          {pending
            ? "Importing…"
            : selected.length
              ? `Import ${selected.length} ${selected.length === 1 ? "project" : "projects"}`
              : "Import projects"}
        </Button>
        {selected.length === 10 && (
          <span className="text-xs text-muted-foreground">Import up to 10 at a time.</span>
        )}
        {message && <output>{message}</output>}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
