# Roadmap

**Done**
- Workspace, tooling, CI, core contracts (run states, events, budgets, pricing).
- Local engine: Docker sandbox, agent loop, tools and permission policy, JSONL run store, `nanogent` CLI.
- Eval suite: 14 small tasks with hidden tests, grading in a fresh sandbox, `nanogent eval` report.
- Hosted execution on Vercel, Neon and our own runner. Production sign-in and a written task have been exercised.
  The dashboard supports live progress, cancellation and diff review. Daytona is an optional sandbox provider.
- New Run offers the configured Anthropic models and shows model pricing separately from the run budget.
- GitHub App connection and project import. Browse authorized repositories at a pinned default-branch commit.
- Start multiple independent runs from one project. Choose and pin a branch for file browsing and future runs.
- Open named project sessions in the header, reopen saved conversations and continue from recent tasks and results.
- Edit existing UTF-8 files in a session draft. Runs snapshot saved edits and show the draft version in patch review.

**Next**
- Finish hosted verification with a verified patch, reload, cancellation, account isolation and 10 concurrent runs.
- Collect the first paired results from Nanogent and mini-SWE-agent on the dependency-backed baseline. Expand the
  suite with larger, multi-step repositories so results can distinguish harness and model changes.

**Repository workspace**
- Verify project branch selection on the deployed app.
- Apply the reviewed patch to a session draft. Show conflicts and keep both versions when the draft changed.
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
