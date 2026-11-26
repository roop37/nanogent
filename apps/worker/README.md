# Runner

A long-running process that executes hosted runs. It reads `queued` runs from Postgres, runs each in a Docker sandbox
on the same host (or in Daytona), and writes events and the result back. It only makes outbound connections, apart
from one small HTTP endpoint the web app uses to wake it up.

## Configuration

Set these in the process environment (for example a systemd `EnvironmentFile` readable only by the service user). Do
not put them in the repository.

| Variable | Purpose | Default |
| --- | --- | --- |
| `NANOGENT_DATABASE_URL` | Postgres connection URL | required |
| `NANOGENT_ANTHROPIC_API_KEY` | Claude API key; never passed to a sandbox | required |
| `NANOGENT_WAKE_SECRET` | Shared with the web app; at least 32 characters | required |
| `NANOGENT_ENV` | `development`, `test` or `production` | `development` |
| `NANOGENT_SANDBOX` | `docker` or `daytona` | `docker` |
| `DAYTONA_API_KEY` | Only for `NANOGENT_SANDBOX=daytona` | |
| `NANOGENT_CONCURRENCY` | Runs at the same time | `2` |
| `NANOGENT_RUNNER_PORT` | Port for `POST /wake` and `GET /healthz` | `8787` |
| `NANOGENT_SWEEP_SEC` | Idle look-up interval | `900` |
| `NANOGENT_DRAIN_SEC` | Time given to running runs on shutdown | `300` |

The model for each run comes from the run itself; the web app sets it from `NANOGENT_ENV`.

## Running

```sh
pnpm install --frozen-lockfile
pnpm db:migrate          # once per database
pnpm build
pnpm sandbox:build       # builds the sandbox image
node apps/worker/dist/main.js
```

[`deploy/nanogent-runner.service`](deploy/nanogent-runner.service) is a systemd unit for this. It assumes a dedicated
`nanogent` user (uid 1002) with rootless Docker, the checkout in `/opt/nanogent/repo` and the variables above in
`/etc/nanogent/runner.env` (`root:nanogent`, mode 640). Rootless Docker needs `DOCKER_HOST=unix:///run/user/1002/docker.sock`
in that file; see [security](../../docs/security.md#runner-host).

## Waking the runner

After saving a run the web app posts `{ "runId": "..." }` to `NANOGENT_RUNNER_URL` with an `x-nanogent-signature`
header (`t=<unix seconds>,v1=<hmac-sha256 of "<t>.<body>">`). Wrong, missing or older-than-a-minute signatures get a
401. Open the port in the host's firewall; nothing else needs to be reachable. If the wake-up is lost, the run starts
on the next sweep.

## Tests

`pnpm --filter @nanogent/worker test` runs the loop and the wake-up endpoint against fakes, and the stored-run
executor against a disposable Postgres when Docker is available.
