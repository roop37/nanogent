"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parentPath } from "@/lib/projects";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Action = "create" | "rename" | "delete" | "restore";
const labels = { create: "New file", rename: "Rename", delete: "Delete", restore: "Restore" };

export function DraftFileActions({
  endpoint,
  href,
  path,
  version,
  kind,
  disabled,
  onUpdating,
}: {
  endpoint: string;
  href: string;
  path: string;
  version: number;
  kind: "folder" | "file" | "deleted";
  disabled?: boolean;
  onUpdating?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const actions: Action[] =
    kind === "folder" ? ["create"] : kind === "deleted" ? ["restore"] : ["rename", "delete"];
  const parent = kind === "folder" ? path : parentPath(path);

  if (!action)
    return (
      <div className="flex gap-2">
        {actions.map((choice) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            key={choice}
            disabled={disabled}
            onClick={() => setAction(choice)}
          >
            {labels[choice]}
          </Button>
        ))}
      </div>
    );

  return (
    <div className="grid gap-2 rounded border border-border p-3">
      {action === "create" || action === "rename" ? (
        <label className="grid gap-2 text-sm" htmlFor="draft-filename">
          Filename
          <Input
            id="draft-filename"
            name="draft-filename"
            form="draft-file-action"
            maxLength={255}
            defaultValue={action === "rename" ? path.split("/").at(-1) : ""}
          />
        </label>
      ) : (
        <p className="text-sm">
          {action === "delete"
            ? "Delete this file from the session draft?"
            : "Restore the original file to this draft?"}
        </p>
      )}
      <form
        id="draft-file-action"
        className="flex flex-wrap gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || disabled) return;
          setError("");
          const name = String(new FormData(event.currentTarget).get("draft-filename") ?? "");
          if ((action === "create" || action === "rename") && (!name || name.includes("/"))) {
            setError("Enter a filename in this folder.");
            return;
          }
          const target = parent ? `${parent}/${name}` : name;
          setPending(true);
          onUpdating?.(true);
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: action,
                path: action === "create" ? target : path,
                ...(action === "rename" && { target }),
                version,
              }),
            });
            const data = await response.json();
            if (!response.ok) {
              setError(data.error ?? "Could not update the draft.");
              return;
            }
            const destination = action === "delete" ? parent : action === "restore" ? path : target;
            if (action === "restore") router.refresh();
            else router.push(`${href}?${new URLSearchParams({ file: destination })}`);
            setAction(undefined);
          } catch {
            setError("Could not confirm the update. Reload the draft before trying again.");
          } finally {
            setPending(false);
            onUpdating?.(false);
          }
        }}
      >
        <Button type="submit" size="sm" disabled={pending || disabled}>
          {pending
            ? "Updating…"
            : action === "rename"
              ? "Save name"
              : action === "create"
                ? "Create file"
                : `Confirm ${action}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setAction(undefined);
            setError("");
          }}
        >
          Cancel
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
