# Roadmap

**Done**
- Workspace, tooling, CI, core contracts (run states, events, budgets, pricing).
- Local engine: Docker sandbox, agent loop, tools and permission policy, JSONL run store, `nanogent` CLI.
- Eval suite: 14 small tasks with hidden tests, grading in a fresh sandbox, `nanogent eval` report.
- Hosted version (code): Postgres run store, Daytona sandboxes, Trigger.dev worker, web dashboard with sign-in, live
  progress, cancel and diff review. Not deployed yet.

**Next**
- Harder eval tasks (multi-step, larger repos, real dependencies) so the suite can tell changes apart; baseline
  against mini-SWE-agent with the same model and budget.

**After that**
- Deploy the hosted version and check it against real services, including 10 runs at once without mixed-up state.
- GitHub: private repos via a GitHub App, work branches, a diff review screen, and opening a PR only after approval.
  Grow the task suite to 50.
- Hardening: teams, quotas, cost tracking, alerts, audit log, secret handling, outbound network allowlist, cleanup jobs.
- Later ideas: more models, custom tools, MCP, project memory, reusable workspaces, repo indexing. Each has to earn its
  place on the task suite.
