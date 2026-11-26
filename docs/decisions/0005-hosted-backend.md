# 0005: Postgres queue, own runner, Docker or Daytona sandboxes

Use Postgres for hosted runs and events. Drizzle gives us a typed schema and checked-in SQL migrations without making
the core interfaces depend on a driver. node-postgres serves the runner and tests; the web server can use Neon's
WebSocket driver. Keep owner IDs as UUIDs to match the existing Neon Auth users, with no cross-schema foreign key.

A run row lock serializes state and sequence changes. Events remain append-only. Results and terminal transitions
commit together. An advisory transaction lock prevents concurrent execution, while persisted active states identify
interrupted work after a connection is lost.

The run table is the queue. Submitting saves a `queued` row; a long-running runner process on our own server reads it,
executes it and writes events back. We tried to avoid a job service: runs last up to half an hour, which rules out
serverless functions, and the runner needs nothing but outbound connections.

Neon's free plan limits compute hours and scale-to-zero can't be turned off, so a runner polling every few seconds
would keep the database awake all month and use the allowance up. Instead the web app sends the runner a signed wake-up
after saving a run (`x-nanogent-signature`, an HMAC of a timestamp and the body, valid for a minute). The runner looks
at the database when woken, every few seconds while it is busy, and every 15 minutes otherwise so a lost wake-up or a
restart can't strand a run. A wake-up carries no data the runner trusts, so a forged one can only cause an extra look-up;
the endpoint is also rate limited.

The agent loop is never retried automatically. A run found `running` with no live worker is marked failed, keeping the
usage already recorded. Cancelling sets a flag the runner watches; a queued run is cancelled directly.

Sandboxes implement the existing interface, so the executor and verification path are shared with local runs. The runner
uses Docker on its own host by default, which can cut the network after setup. Daytona remains available
(`NANOGENT_SANDBOX=daytona`); its network settings depend on the account tier, see [security](../security.md).

Keep the UI, sign-in handlers and private GitHub access out of this change.
