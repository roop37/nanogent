# Web dashboard

Next.js App Router, Neon Auth and Postgres. Sign in with GitHub, Google, or email and password, submit a public repository,
watch events, cancel a run, and review verification and the diff. The browser polls persisted events; reloading a run
replays them from sequence 1. Authentication endpoints are public so users can sign in; all run endpoints require a
server-validated session. Every dashboard page checks the session before reading data.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @nanogent/config... --filter @nanogent/controller... build
pnpm --filter @nanogent/web dev
```

Supply configuration through the process environment. Do not put credentials in this checkout. No environment files
are included. The production build needs no credentials and makes no calls to Neon, the runner or the model.

## Vercel environment

| Variable | Purpose / default |
| --- | --- |
| `NEON_AUTH_BASE_URL` | Existing branch's managed Auth URL, including its `/auth` path |
| `NEON_AUTH_COOKIE_SECRET` | App-generated random secret of at least 32 characters; same on every web instance |
| `NANOGENT_DATABASE_URL` | Neon Postgres connection URL for the branch containing runs and Auth users |
| `NANOGENT_RUNNER_URL` | Optional. The runner's wake-up endpoint, e.g. `http://203.0.113.10:8787/wake`. Without it the runner finds new runs on its next sweep |
| `NANOGENT_WAKE_SECRET` | Optional, at least 32 characters, shared with the runner. Used to sign wake-ups |
| `NANOGENT_ENV` | Sets the default web model to Haiku in development and Sonnet in production |
| `NANOGENT_WEB_MODELS` | Optional comma-separated Anthropic model IDs. The first is the default. Example: `claude-sonnet-5-5,claude-haiku-5-5` |
| `NANOGENT_DAILY_CAP_USD` | Per-user daily model-cost admission budget, default `1` USD |
| `NANOGENT_MAX_RUN_COST_USD` | Per-run ceiling, default `1` USD, also capped by the daily budget |
| `NEXT_TELEMETRY_DISABLED` | Optional `1` to disable Next.js telemetry |

Neon's current `neon deploy` / `neon env pull` outputs use `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and `DATABASE_URL`
in `.env.local`. This app uses `NEON_AUTH_BASE_URL` unchanged. Its server SDK handles sessions, so it does not need
`NEON_AUTH_JWKS_URL`. Map `DATABASE_URL` to `NANOGENT_DATABASE_URL`. Neon does **not** generate
`NEON_AUTH_COOKIE_SECRET`; create and store it through your secret manager. No auth URL alias or `NEXT_PUBLIC_*`
credential is needed. The browser uses the same-origin `/api/auth` SDK proxy.

Do not configure Anthropic or Daytona keys in Vercel. They belong only in the runner's environment. Never pass
runner credentials or the database URL to browser code or sandbox input.

## Limits and recovery

New Run shows the allowed models and their input and output rates per million tokens. The run budget is set
separately. Without `NANOGENT_WEB_MODELS`, only the environment's default model is offered. To enable a choice in
production, set the list in Vercel Production and redeploy. The runner executes the selected model from the run spec.

Only credential-free HTTPS URLs on `github.com`, `gitlab.com`, and `bitbucket.org` are accepted. The repository must be
public; an inaccessible repository fails during clone. No server-side fetch is made to inspect arbitrary URLs.

A Postgres advisory transaction lock serializes submissions for a user across web instances. The limit is three active
runs. Active run budgets remain reserved across midnight; completed, failed and canceled runs charge their recorded
cost on their UTC completion day. Costs recorded in events are counted even if a terminal result is missing. The check
covers all owned runs, independently of the latest-100 display limit. It rejects a request that would exceed the daily
budget instead of silently changing the requested run budget. Existing workers enforce the run limits after each
response; a response already in flight can overshoot its model-cost limit. This budget is not a provider billing cap
and does not include sandbox, database or hosting charges.

A saved run is picked up by the runner, so a lost wake-up only delays it. If something fails after the run was saved, the
response keeps its run ID and the UI says the start could not be confirmed. The queued row continues to reserve budget
and the user can cancel it. Cancellation of a running run takes a moment while the runner destroys its sandbox.

## Checks

```sh
scripts/check.sh
pnpm --filter @nanogent/web build
pnpm --filter @nanogent/web test:smoke
```

Route tests use fake sessions and controllers. Database tests use disposable local Postgres when Docker is available
and a fake runner notifier; they cover quota accounting and competing submissions from separate pools. The smoke runner starts a local Next dev server with a scripted in-memory
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
2. In the Neon branch used by Vercel Production, add `https://nanogent.hoizr.com` and `https://nanogent.vercel.app`
   under Auth → Configuration → Domains. Add each origin separately, including `https://` and omitting the trailing
   slash. A `403 INVALID_ORIGIN` during sign-up or sign-in means Neon does not trust the origin of that request.
   Check the branch's email/password and verification settings. If verification is enabled, configure email delivery
   and test the verification callback to `/`. Production email delivery requires custom SMTP. Test sign-up, sign-out,
   sign-in, wrong-password handling, and session recovery after reload against the deployed Auth branch.
3. Run `pnpm db:migrate` from the repo root on your computer. Paste the connection string for the target Neon database
   at the hidden prompt, or export it as `NANOGENT_DATABASE_URL` for noninteractive use. This applies the Nanogent
   schema and leaves the `neon_auth` schema alone.
4. Run `vercel link` at the repo root. Select the Next.js framework and set Root Directory to `apps/web`; enable access
   to source outside that directory. Set Install Command to `cd ../.. && pnpm install --frozen-lockfile` and Build Command
   to `cd ../.. && pnpm exec turbo run build --filter=@nanogent/web`. Keep the default Next.js output directory.
   For a local production build, run `pnpm --filter @nanogent/config... --filter @nanogent/controller... build`,
   then `pnpm --filter @nanogent/web build`.
5. Add the web variables above to Vercel Preview/Production settings, with matching Neon branches. Keep the cookie
   secret stable. Deploy Vercel through the human's chosen Git or CLI workflow.
6. Set up the runner on a server as described in [the runner README](../worker/README.md): database URL, Anthropic key
   and the same `NANOGENT_WAKE_SECRET` as the web app. Open its wake port and set `NANOGENT_RUNNER_URL` on Vercel.
7. Test one small public task, cancellation and reload recovery, and confirm another account cannot read its ID.

For an existing deployment, push the release commit and confirm the Vercel production deployment serves it. Update
the runner checkout to the same release using the [runner update steps](../worker/README.md#updating-a-running-service).
The Result view and model picker need no run schema migration. Set `NANOGENT_WEB_MODELS` in Vercel Production before
deploying if users should have a choice of models. After both services are ready, start a planning run and check its
full written result. Start a second public-repo run with a verification command and check the verified patch on reload.

SDK references: [Neon Next.js setup](https://neon.com/docs/auth/quick-start/nextjs-api-only),
[managed Auth environment](https://neon.com/docs/ai/skills/neon-auth/references/managed-auth.md), and
[Neon serverless driver](https://neon.com/docs/serverless/serverless-driver).

## GitHub project import

Register one GitHub App for the production deployment. In GitHub App settings set:

- Homepage URL: `https://nanogent.hoizr.com`
- Callback URL: `https://nanogent.hoizr.com/api/github/callback`
- Setup URL: `https://nanogent.hoizr.com/projects`
- Installation availability: **Any account**
- Repository permissions: **Contents: Read-only** and **Metadata: Read-only**
- Keep **Expire user authorization tokens** enabled. Leave **Request user authorization during installation** off.
  The dashboard starts authorization and installation as separate steps. Webhooks are optional for import.

Set these server environment variables in Vercel Production:

| Variable | Value |
| --- | --- |
| `NANOGENT_GITHUB_ORIGIN` | `https://nanogent.hoizr.com`, without a trailing slash |
| `NANOGENT_GITHUB_APP_SLUG` | The GitHub App's URL slug |
| `NANOGENT_GITHUB_CLIENT_ID` | The GitHub App client ID |
| `NANOGENT_GITHUB_CLIENT_SECRET` | The GitHub App client secret |
| `NANOGENT_GITHUB_TOKEN_KEY` | 32 random bytes encoded as unpadded base64url, stored as a secret |

Apply `pnpm db:migrate` against the production database before deploying. Use the configured origin when connecting
GitHub. The existing Neon Auth sign-in remains separate. From **Import projects**, connect GitHub and configure
repository access for the GitHub App. Import one or more repositories and open them in the sidebar. Each project
pins the default branch at import. File previews display UTF-8 text up to 128 KiB. Disconnecting removes the saved
credentials and keeps the user's imported project entries. Rotating the token key requires reconnecting GitHub.

Open a public project and choose **New session** to start a run from its pinned commit. A project can have
multiple independent runs. Open them from **Sessions** on the project page. The general **New run** form also
lets you select an imported project or paste a public repository URL. Private projects support file browsing.

See [GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
and [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Workspace

The dark interface uses VS Code Dark Modern colours, Inter for UI text, and JetBrains Mono for code and numbers.
Fonts are bundled locally. The frame has an activity bar, a 220–420 px resizable run explorer, session editor tabs,
and a status bar. Below 900 px the explorer becomes a drawer and the tabs become a title switcher.

Use Cmd/Ctrl+K to search commands and runs, Cmd/Ctrl+B to toggle the explorer, and N to open a new run outside a text
field. Up/down moves through explorer rows; Enter opens a run. Cmd/Ctrl+Enter submits the new-run form.
Open tabs last for the browser session; denied storage falls back to in-memory tabs.

The shared run list refreshes every five seconds with active runs and every thirty seconds otherwise. Hidden tabs
abort outstanding polls and stop both list and event polling; returning to the tab refreshes immediately. The status
bar's connection indicator reports the last run-list request. Its budget includes active reservations, matching the
server's allowance calculation. Today and Earlier use UTC dates.

## Run review

Result shows the full written answer for a planning or analysis task and the summary for a code change. Use **Copy
result** to take the text with you. Completed runs with a written result and no patch open on Result, with **View
activity** available for the session history. Verification records the optional command configured when starting the run.

Activity groups each command with its result and follows new events while a run is active. Scroll up to read earlier
output, then use **Jump to latest** to resume following. Reloading reconstructs the timeline from recorded events.
Cmd/Ctrl+. opens the cancellation dialog. The status badge updates when the runner records the cancellation.

Changes shows the final patch or the latest snapshot when the run API supplies one. The desktop divider can be
dragged or adjusted with the keyboard. Pane sizes are saved in the browser. Below 900 px, use the Activity, Changes
and Verify tabs. Split diffs are available from 1100 px. In the diff, J and K move between file headers, and `[`
and `]` collapse and expand all files. Expandable context is limited to lines included in the patch. Long files show
the first 2,000 lines until you choose **Show rest**. Copy or download the full patch at any time.

Verification shows the harness command, exit code, duration and output. Events shows the raw records. Select a type
to filter the list and copy the filtered records as JSON.

## Social sign-in

Email/password, GitHub and Google use the installed Neon Auth SDK and the same-origin `/api/auth` proxy. Set
`NANOGENT_AUTH_PROVIDERS` to a comma-separated list of `github` and `google` (default `google,github`). An empty value
hides both social options; unsupported values fail configuration validation. Only this provider list reaches the
browser. Return paths must begin with a single `/`; external URLs, backslashes and control characters are rejected.

Configure the providers on the existing Neon branch:

1. GitHub: create an OAuth App under Settings → Developer settings. Set Homepage URL to
   `https://nanogent.hoizr.com` and Authorization callback URL to `{NEON_AUTH_BASE_URL}/callback/github`.
   The base URL already ends in `/<db>/auth`, so the callback looks like
   `https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth/callback/github`.
2. Google: create an OAuth client of type Web application. Add `{NEON_AUTH_BASE_URL}/callback/google` as an
   authorized redirect URI. Google's shared Neon credentials work for development; use our own client in production.
3. Add each client ID and secret to the Neon branch under Auth → Settings → OAuth providers. The CLI alternative is
   `neon neon-auth oauth-provider add --provider-id github --oauth-client-id ... --oauth-client-secret ...`
   (use `google` for Google).
4. Confirm both web origins from the deployment steps are trusted. The trusted domains also control where OAuth and
   email verification can redirect.

Client secrets live only in Neon. Never commit them or put them in web environment variables. Providers redirect to
Neon's callback, then return to `/` or the validated `next` path. Failed redirects return a plain error on sign-in.

## Screenshots

```sh
pnpm --filter @nanogent/web shots
```

The command starts its own local test-mode dev server, blocks external browser requests, sets a test session cookie,
and writes PNGs to the ignored `apps/web/.shots/` directory. It captures sign-in, sign-up, home with runs, home empty,
new run, running, verified, failed, canceled and long-diff views, the command palette and the collapsed explorer at
1440 × 900 and 390 × 844. It also captures the mobile Changes and Verify tabs and the mobile drawer. Reduced motion
keeps captures stable. The screenshot and smoke servers hide Next.js development indicators.
The commands use the same Chromium availability check.
A missing browser or the known macOS Mach-port denial prints a skip reason; other failures remain fatal.

Test mode seeds eight runs: running, queued, blocked, three verified completions, verification failure and cancellation.
The `nanogent-test-session=signed-in` cookie selects that account. Use `nanogent-test-session=empty` for a separate
unseeded account, including submission tests. The seeded account has three active runs; cancel one to submit another.
The seed and test-session bypass are both disabled outside the restricted local test environment.
New runs in test mode advance on new event cursors, so a replay or an interrupted response can be fetched again.
