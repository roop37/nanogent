# Roadmap

**Done**
- Workspace, tooling, CI, core contracts (run states, events, budgets, pricing).
- Local engine: Docker sandbox, agent loop, tools and permission policy, JSONL run store, `nanogent` CLI.

**Next**
- Evaluation suite: task format, a first set of 10 tasks, a verifier that applies the diff in a fresh sandbox, and a
  report with success rate, cost, time and verified successes per dollar. Baseline against mini-SWE-agent.

**After that**
- Hosted version: web dashboard with sign-in, runs and events in Postgres, jobs on Trigger.dev, Daytona sandboxes, live
  progress, cancel, recovery after worker crashes. Must handle 10 runs at once without mixing up state.
- GitHub: private repos via a GitHub App, work branches, a diff review screen, and opening a PR only after approval.
  Grow the task suite to 50.
- Hardening: teams, quotas, cost tracking, alerts, audit log, secret handling, outbound network allowlist, cleanup jobs.
- Later ideas: more models, custom tools, MCP, project memory, reusable workspaces, repo indexing. Each has to earn its
  place on the task suite.
