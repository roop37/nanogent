# 0006: Web dashboard and managed authentication

Use Next.js App Router for the dashboard and route handlers. Neon Auth manages email/password accounts and sessions;
the app uses its Next.js SDK rather than hosting another auth server or migrating the existing `neon_auth` schema.
Owner IDs are UUIDs from the validated session. Server-rendered pages check the session before loading data, and route
handlers repeat that check independently. Reads, event replay and cancellation require ownership. The auth proxy stays
public so sign-in and sign-up can work. Mutations also reject cross-origin requests.

Keep database and session code behind `server-only`. Drizzle's Neon WebSocket driver supports the interactive
transactions required by `PostgresRunStore`. Each request owns and closes its pool. The web process submits through
`RemoteController`; only the runner holds model and sandbox credentials. A remote-only controller export keeps the local
executor out of the web runtime dependency path.

Serialize admission with a Postgres advisory lock per owner. Reserve active run budgets, including runs started before
midnight, and charge terminal recorded costs on their completion day in UTC. This keeps concurrent requests from
passing the same three-run or daily-budget check. The default daily model budget is one dollar. Existing post-response
limits can overshoot by an in-flight response; admission does not claim to impose a provider billing cap.

Poll stored events using an inclusive sequence cursor and batches of 100. Read the run snapshot before the event page
so observing a terminal state means its preceding events are already persisted. Drain remaining pages before stopping.
Reload starts at sequence 1; transient failures retain the cursor and retry. The database remains the source of truth,
without a separate progress store.

A run that is saved but not yet started stays visible as queued and keeps its budget reserved until it runs or is cancelled. Tests use injected dependencies. The browser smoke test uses local-only fake
auth and a scripted controller, with a runtime check that rejects the bypass on Vercel or in production.
