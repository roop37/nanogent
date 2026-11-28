"use client";

import { useState } from "react";
import { DraftFileActions } from "./draft-file-actions";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function SessionFileEditor({
  endpoint,
  href,
  path,
  initial,
  version: initialVersion,
}: {
  endpoint: string;
  href: string;
  path: string;
  initial: string;
  version: number;
}) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const usesCrlf = initial.includes("\r\n") && !initial.replaceAll("\r\n", "").includes("\n");

  return (
    <>
      <DraftFileActions
        endpoint={endpoint}
        href={href}
        path={path}
        version={version}
        kind="file"
        disabled={busy || text !== saved}
        onUpdating={setUpdating}
      />
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || updating || text === saved) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const response = await fetch(endpoint, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path, version, text }),
            });
            const data = await response.json();
            if (!response.ok) {
              setError(data.error ?? "Could not save the draft.");
              return;
            }
            setSaved(text);
            setVersion(data.version);
            setNotice(`Saved draft version ${data.version}.`);
          } catch {
            setError("Could not confirm the save. Keep a copy of your edits before reloading.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="draft-file" className="break-all font-mono text-sm">
          {path}
        </label>
        <Textarea
          id="draft-file"
          rows={18}
          spellCheck={false}
          disabled={updating}
          className="font-mono leading-6"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(usesCrlf ? value.replaceAll("\n", "\r\n") : value);
            setNotice("");
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || updating || text === saved}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
          <span className="text-sm text-muted-foreground">Draft version {version}</span>
          {notice && <output>{notice}</output>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
