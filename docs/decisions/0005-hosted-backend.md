# 0005: Postgres, Trigger.dev and Daytona

Use Postgres for hosted runs and events. Drizzle gives us a typed schema and checked-in SQL migrations without making
the core interfaces depend on a driver. node-postgres serves the worker and tests; the web server can use Neon's
WebSocket driver. Keep owner IDs as UUIDs to match the existing Neon Auth users, with no cross-schema foreign key.

A run row lock serializes state and sequence changes. Events remain append-only. Results and terminal transitions
commit together. An advisory transaction lock prevents concurrent execution, while persisted active states identify
interrupted work after a connection is lost. Holding a connection per run costs capacity, but is simple enough for
ten concurrent runs. It requires transaction-capable connections and an appropriate pool size.

Trigger.dev owns job delivery, cancellation and progress metadata. The task receives only a run ID and loads its spec
from Postgres. A persisted Trigger handle supports cancellation from another process. Idempotency keys avoid duplicate
submission; Postgres guards the execution itself. Do not automatically retry the model loop. Retry only transient
sandbox setup failures before the first model call. A failed enqueue can be retried explicitly by run ID.

Daytona implements the existing sandbox interface, so the executor and verification path stay shared with local runs.
Use its default Node 24 snapshot now, with an optional snapshot built from our Dockerfile. A Python shell wrapper
provides persistent bash, bounded output and process-group timeouts; SDK request timeouts alone do not stop commands.
File operations remain confined to the provider's workspace.

Network isolation is conditional on the Daytona tier. Production fails if blocking egress after setup is refused.
Development may explicitly accept the documented essential-services fallback, with a warning event and public code
only. This gap is recorded in [security](../security.md); it must be closed before private repositories are supported.

Keep the UI, sign-in handlers, private GitHub access and scheduled cleanup out of this change. The backend exposes the
storage, execution and cancellation contracts those features will use.
