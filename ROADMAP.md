# Roadmap

**Done**
- Workspace, tooling, CI, core contracts (run states, events, budgets, pricing).
- Local engine: Docker sandbox, agent loop, tools and permission policy, JSONL run store, `nanogent` CLI.
- Eval suite: 14 small tasks with hidden tests, grading in a fresh sandbox, `nanogent eval` report.
- Hosted execution on Vercel, Neon and our own runner. Production sign-in and a written task have been exercised.
  The dashboard supports live progress, cancellation and diff review. Daytona is an optional sandbox provider.
- New Run offers the configured Anthropic models and shows model pricing separately from the run budget.

**Next**
- Finish hosted verification with a verified patch, reload, cancellation, account isolation and 10 concurrent runs.
- Harder eval tasks (multi-step, larger repos, real dependencies) so the suite can tell changes apart; baseline
  against mini-SWE-agent with the same model and budget.

**Repository workspace**
- Require GitHub connection to enter the workspace. List authorized repositories, and let users import or create
  projects from the sidebar. Browse the selected branch's file tree at a recorded commit.
- Open multiple named sessions per project in the header. Save their conversations and separate drafts across reloads.
  Edit in the browser, run tasks against a draft snapshot, and review or apply the resulting patch. Surface conflicts
  if the draft changed during the run. Keep execution on the runner without an interactive terminal or preview.
- Pull remote changes with conflict handling. Commit reviewed changes to a work branch, and require an explicit user
  action to push it or open a PR. Keep GitHub credentials on the server.

**Model providers**
- Add a second provider with the same tool, verification and budget contracts. Validate it on the eval suite before
  enabling it for hosted runs.
- Let users choose a provider and then a model from the enabled catalog on each run, including workspace runs. Save
  both choices in run history and account for usage with that provider's pricing.

**After that**
- Grow the task suite to 50.
- Hardening: teams, quotas, cost tracking, alerts, audit log, secret handling, outbound network allowlist, cleanup jobs.
- Later ideas: custom tools, MCP, project memory and repo indexing. Each has to earn its place on the task suite.
