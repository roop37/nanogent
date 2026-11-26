# Hosted worker

The exported `execute-run` task accepts `{ runId }`. Its plain function, `executeStoredRun`, is tested against Docker
Postgres with a fake brain and sandbox. The task itself uses Claude, Daytona and Postgres only when a human starts it.

Configure these variables in the worker process or Trigger environment. Do not create an `.env` file in the repository.

| Variable | Purpose |
| --- | --- |
| `NANOGENT_DATABASE_URL` | Postgres connection URL; Neon SSL modes use verified certificates |
| `NANOGENT_ANTHROPIC_API_KEY` | Claude model client, never sent to the sandbox |
| `DAYTONA_API_KEY` | Daytona control client, never sent to the sandbox |
| `NANOGENT_ENV` | `development`, `test` or `production`; production requires network blocking |
| `TRIGGER_PROJECT_REF` | Optional project override; defaults to `proj_dnaruiydwcvmfbbyntay` |
| `TRIGGER_SECRET_KEY` | Needed by the application calling `RemoteController`; configure for its Trigger environment |

The Trigger CLI uses the human's existing login for development and deployment. No credential discovery happens in
this code. The task queue allows ten concurrent runs, with one attempt per task and at most two transient setup retries.
The database pool has room for ten execution locks and their event writes. Database availability is required throughout
execution, including cancellation monitoring.

From the repository root, with the database URL already provided by the environment:

```sh
pnpm install
pnpm db:migrate
pnpm build
cd apps/worker
npx trigger.dev@latest dev
```

For deployment, a human runs `npx trigger.dev@latest deploy` from `apps/worker`. The build extension packages the system
prompt and Python sandbox helpers. Task imports use `@trigger.dev/sdk`; the build extension uses `@trigger.dev/build`.
No scheduler, UI or private repository access is configured here.

The API caller must check ownership before calling `RemoteController`. It creates the row, triggers the task with the
run ID as its idempotency key, and persists the returned handle. If triggering fails ambiguously, call `enqueue(runId)`
to retry the same ID. Cancellation first sets a durable flag, then cancels the Trigger handle. Workers also poll the
flag, so an interrupted cancellation request can still stop active work.

Production fails closed when the Daytona tier cannot block egress. Development permits the documented essential-services
fallback with a warning event. See [security](../../docs/security.md) before choosing the runtime environment.
