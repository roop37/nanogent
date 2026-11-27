# 0007 — Dark workspace and social sign-in

Status: accepted

## Decision

Use VS Code Dark Modern colours and an editor-style frame: activity bar, run explorer, editor tabs and a compact
status bar. Active runs stay visible beside the current page, with explicit state labels and indicators.

Dark only keeps code, diffs and terminal output on one consistent surface. Inter and JetBrains Mono are self-hosted,
with the Latin fonts preloaded and other subsets loaded as needed. UI text is 13 px, with tabular monospace numbers,
flat borders and restrained 140 ms transitions. The sign-in replay and active command cursor animate while visible.
Reduced-motion preferences disable animation and transitions. Status labels accompany colour indicators.

The explorer collapses and resizes between 220 and 420 px. Below 900 px it is a modal drawer; tabs become a compact
switcher. Session storage remembers open tabs, with a memory-only fallback when storage is blocked. Cmd/Ctrl+K opens
a focus-managed command palette. N starts a new run outside text fields; Cmd/Ctrl+B toggles the explorer.

One shared list request supplies the explorer, overview and palette. Poll every five seconds while any run is active,
otherwise every thirty seconds. Stop list and event polling when hidden and refresh on return. Abort abandoned
requests so stale responses cannot start extra polling loops. Read budget usage from the owner-scoped allowance,
including reservations, rather than summing the limited display list.

The run view pairs a terminal-style Activity pane with a patch review pane and a collapsible Verification and
Events panel. Tool results update their recorded command blocks. Following activity pauses when the reader scrolls
away. The browser remembers the desktop pane widths. Below 900 px the run view uses tabs. Split view needs
1100 px. The patch viewer expands only context present in the patch, limits the initial display to 2,000 lines
per file, and loads syntax highlighting after the text renders.

Use Neon Auth's social sign-in API for GitHub and Google alongside email/password. The server validates the configured
provider list. Callback destinations must be local paths; provider credentials stay in Neon. The web server retains
its independent session and ownership checks. Browser tests intercept the same SDK proxy requests without contacting
OAuth providers.

## Consequences

There is no light-theme preference to maintain. The shell remains mounted across navigation, and its list is eventually
consistent at the polling cadence. Mobile keeps the connection and allowance in the status bar. Provider setup remains
a human operation on the Neon branch; missing provider configuration produces a plain sign-in error.
