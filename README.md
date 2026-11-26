# Nanogent

Nanogent takes a git repository and a task written in plain English, works on it inside a locked-down container,
runs the tests itself and gives you back a summary and a diff.

It is a harness, not a model. The interesting parts are the boring ones: what the agent is allowed to touch, how long
and how much it may spend, where its commands run, and whether the result actually passes before anyone calls it done.

```
$ nanogent run --repo tests/fixtures/repos/calc-bug \
    --task "The validation tests fail. Fix parseAmount so the tests pass." \
    --verify "node --test"
...
completed: Fixed parseAmount in index.js ...
Verified: PASS
Cost: $0.0009
diff --git a/index.js b/index.js
...
```

## How a run works

1. A container is created from `packages/sandbox/docker`. The repo is cloned (or copied) and any `--setup` commands run
   with network access.
2. The network is cut. Claude works in `/workspace` through a shell tool and a file editor tool.
3. When the agent submits, Nanogent runs the `--verify` command itself. A run only counts as completed if that passes.
4. The diff is collected, every event is written to `~/.nanogent/runs/<id>/`, and the container is removed.

Every run has limits on turns, tool calls, tokens, dollars and wall-clock time. See [docs/security.md](docs/security.md)
for the threat model.

## Getting started

Requires Node 24, pnpm 10 and Docker.

```bash
pnpm install
scripts/check.sh                       # lint, typecheck, unit tests, docker tests
export NANOGENT_ANTHROPIC_API_KEY=...
pnpm nanogent run --repo <git-url-or-path> --task "..." --verify "npm test"
pnpm nanogent list
pnpm nanogent show <run-id>
```

Configuration is read from the environment:

| Variable | Default |
| --- | --- |
| `NANOGENT_ENV` | `development` (`test`, `production`) |
| `NANOGENT_MODEL` | `claude-haiku-5-5` outside production, `claude-opus-5-5` in production |
| `NANOGENT_EFFORT` | `medium` outside production, `high` in production |
| `NANOGENT_REFUSAL_FALLBACK` | `off` outside production, `on` in production |
| `NANOGENT_HOME` | `~/.nanogent` |

Tests never call the model API; the model client is replaced with scripted responses.

## Hosted mode

The web dashboard supports email/password sign-in, task submission, live events, cancellation, verification and diff
review. Neon stores runs, Trigger.dev runs the worker, and Daytona supplies sandboxes. The web server never receives
model or sandbox credentials. See [web setup](apps/web/README.md) for environment variables and human deployment steps.

## Status

The local engine, eval suite and hosted dashboard are implemented. Live service deployment still needs the checks in
the setup guide. Next up are harder eval tasks and private repository integration. See
[ROADMAP.md](ROADMAP.md) and [docs/design.md](docs/design.md).

## License

Apache-2.0
