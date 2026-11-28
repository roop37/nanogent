"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function CreateProjectSession({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button onClick={() => setOpen(true)}>New session</Button>;
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        const name = new FormData(event.currentTarget).get("name");
        try {
          const response = await fetch(`/api/projects/${projectId}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await response.json();
          if (!response.ok) {
            setError(data.error);
            return;
          }
          router.push(`/projects/${projectId}/sessions/${data.id}`);
        } catch {
          setError("Could not create the session. Check the project before trying again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-medium" htmlFor="session-name">
        Session name
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="session-name" name="name" className="w-56 max-w-full" maxLength={100} required />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create session"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setError("");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
