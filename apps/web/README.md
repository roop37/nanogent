# Web dashboard

Next.js App Router, Neon Auth, Postgres and Trigger.dev. Sign in with email and password, submit a public repository,
watch events, cancel a run, and review verification and the diff. The browser polls persisted events; reloading a run
replays them from sequence 1. Authentication endpoints are public so users can sign in; all run endpoints require a
server-validated session. Every dashboard page checks the session before reading data.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @nanogent/controller... build
pnpm --filter @nanogent/web dev
```

Supply configuration through the process environment. Do not put credentials in this checkout. No environment files
are included. The production build needs no credentials and makes no calls to Neon, Trigger.dev, Daytona or the model.

## Vercel environment

| Variable | Purpose / default |
| --- | --- |
| `NEON_AUTH_BASE_URL` | Existing branch's managed Auth URL, including its `/auth` path |
| `NEON_AUTH_COOKIE_SECRET` | App-generated random secret of at least 32 characters; same on every web instance |
| `NANOGENT_DATABASE_URL` | Neon Postgres connection URL for the branch containing runs and Auth users |
| `TRIGGER_SECRET_KEY` | Trigger environment key used only by the web server to submit and cancel jobs |
| `NANOGENT_ENV` | `development`; `production` permits all models in `packages/config` |
| `NANOGENT_DAILY_CAP_USD` | Per-user daily model-cost admission budget, default `1` USD |
| `NANOGENT_MAX_RUN_COST_USD` | Per-run ceiling, default `1` USD, also capped by the daily budget |
| `NEXT_TELEMETRY_DISABLED` | Optional `1` to disable Next.js telemetry |

Neon's current `neon deploy` / `neon env pull` outputs use `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and `DATABASE_URL`
in `.env.local`. This app uses `NEON_AUTH_BASE_URL` unchanged. Its server SDK handles sessions, so it does not need
`NEON_AUTH_JWKS_URL`. Map `DATABASE_URL` to `NANOGENT_DATABASE_URL`. Neon does **not** generate
`NEON_AUTH_COOKIE_SECRET`; create and store it through your secret manager. No auth URL alias or `NEXT_PUBLIC_*`
credential is needed. The browser uses the same-origin `/api/auth` SDK proxy.

Do not configure Anthropic or Daytona keys in Vercel. They belong only in the Trigger worker environment. Never pass
worker credentials, the database URL, or the Trigger key to browser code or sandbox input.

## Limits and recovery

Only credential-free HTTPS URLs on `github.com`, `gitlab.com`, and `bitbucket.org` are accepted. The repository must be
public; an inaccessible repository fails during clone. No server-side fetch is made to inspect arbitrary URLs.

A Postgres advisory transaction lock serializes submissions for a user across web instances. The limit is three active
runs. Active run budgets remain reserved across midnight; completed, failed and canceled runs charge their recorded
cost on their UTC completion day. Costs recorded in events are counted even if a terminal result is missing. The check
covers all owned runs, independently of the latest-100 display limit. It rejects a request that would exceed the daily
budget instead of silently changing the requested run budget. Existing workers enforce the run limits after each
response; a response already in flight can overshoot its model-cost limit. This budget is not a provider billing cap
and does not include sandbox, database or hosting charges.

If dispatch fails after the run was saved, the response keeps its run ID and the UI explains that dispatch is uncertain.
The queued row continues to reserve budget. An operator can retry `RemoteController.enqueue(id)` with the same ID;
the Trigger idempotency key prevents a second job. The user can also cancel the queued run. No automatic paid-loop
retries are added. Cancellation may take time while the worker destroys its sandbox.

## Checks

```sh
scripts/check.sh
pnpm --filter @nanogent/web build
pnpm --filter @nanogent/web test:smoke
```

Route tests use fake sessions and controllers. Database tests use disposable local Postgres when Docker is available
and fake Trigger calls; they cover quota accounting and competing submissions from separate pools. The smoke runner starts a local Next dev server with a scripted in-memory
backend and a test session cookie; it never contacts an external service. It checks sign-in redirects, submission,
events, reload recovery, cancellation, and a verified diff at desktop and mobile widths. Its environment is restricted
to local process essentials. Webpack polling is used for the smoke server so restricted macOS file watching works.

The smoke test runs from `scripts/check.sh` when Playwright Chromium is installed; otherwise it prints a skip reason. The specific macOS sandbox denial of Chromium Mach-port registration also skips
with an explicit reason; other browser launch failures and all test failures remain fatal.
Install it with `pnpm --filter @nanogent/web exec playwright install chromium`. Use `PLAYWRIGHT_BROWSERS_PATH` for a
custom browser location. `NANOGENT_WEB_TEST_MODE=1` works only with `NODE_ENV=development`, `NANOGENT_ENV=test`, and
no `VERCEL` environment. Never configure it on a deployment. It does not bypass auth in production builds.

## Human deployment steps

Nothing here provisions or deploys services automatically.

1. Auth is already provisioned. In a separate temporary setup directory, run `neon init`, link the existing project and
   intended branch, and review the generated `neon.ts` with `auth: true`. Run `neon deploy` only after reviewing its
   proposed changes. Do not create a replacement Auth project or run Better Auth migrations. These CLI commands can
   write `.env.local` and editor configuration; keep those files outside this repo and transfer needed values directly
   into the deployment's secret settings. Do not copy generated tooling into the checkout.
2. Configure the web origin and development origin as trusted domains in Neon Auth. Check the branch's email/password
   and verification settings. If verification is enabled, configure email delivery and test the verification callback
   to `/`. Production email delivery requires custom SMTP. Test sign-up, sign-out, sign-in, wrong-password handling,
   and session recovery after reload against the deployed Auth branch.
3. Set `NANOGENT_DATABASE_URL` in the human process environment, then run `pnpm db:migrate` at the repo root. This applies
   only the run/event schema; it does not modify `neon_auth`.
4. Run `vercel link` at the repo root. Select the Next.js framework and set Root Directory to `apps/web`; enable access
   to source outside that directory. Set Install Command to `cd ../.. && pnpm install --frozen-lockfile` and Build Command
   to `cd ../.. && pnpm exec turbo run build --filter=@nanogent/web`. Keep the default Next.js output directory.
   A root-shell equivalent is `pnpm --filter @nanogent/controller... build && pnpm --filter @nanogent/web build`.
5. Add the web variables above to Vercel Preview/Production settings, with matching Neon branches and Trigger
   environments. Keep the cookie secret stable. Deploy Vercel through the human's chosen Git or CLI workflow.
6. Set worker variables from [the worker README](../worker/README.md) in Trigger.dev, including its database URL,
   Anthropic key and Daytona key. From `apps/worker`, run `npx trigger.dev@latest deploy`. The checked-in Trigger config
   is sufficient; do not run init in this checkout or copy generated editor/tooling files here.
7. Before a human starts a live run, verify the worker's Daytona network policy. The existing restricted tier allows
   essential-services egress; production requires a tier that supports blocking it. See [security](../../docs/security.md).
   Then test one small public task, cancellation and reload recovery, and confirm another account cannot read its ID.

SDK references: [Neon Next.js setup](https://neon.com/docs/auth/quick-start/nextjs-api-only),
[managed Auth environment](https://neon.com/docs/ai/skills/neon-auth/references/managed-auth.md), and
[Neon serverless driver](https://neon.com/docs/serverless/serverless-driver).
