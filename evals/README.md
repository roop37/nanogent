# Evals

Each folder under `tasks/` is one task:

```
task.json     id, title, difficulty, category, instruction, verify command, optional setup commands
repo/         the code the agent works on
hidden/       tests copied in only when grading; the agent never sees them
solution/     a reference fix, used to check that the task itself is sound
```

Grading takes the agent's diff, applies it to a fresh copy of `repo/` with `git apply`, adds `hidden/`, and runs the
verify command in a new sandbox. Passing the visible tests inside the agent's own sandbox doesn't count.

```bash
pnpm eval --check                    # every task fails as shipped and passes with its solution (no API calls)
pnpm eval                            # run the suite; report goes to ~/.nanogent/evals/<timestamp>-<model>/
pnpm eval --only csv-quoted-fields --repeat 3 --max-cost 0.25 --concurrency 2
```

The report has success rate by difficulty and category, total cost, passes per dollar, median cost per pass, and how
many attempts passed the visible tests but failed the hidden ones.

## Paired baseline

The 14 tasks in `tasks/` remain the harness smoke suite. `baseline/` starts a separate benchmark with two tasks
that install locked npm dependencies before the network is cut. One adds a JSON array mode to a CSV CLI. The
other extends the runtime and TypeScript API of a pinned MIT-licensed slugify snapshot. The snapshot includes the
upstream source, docs and license, with a smaller test and dependency setup for grading.

```sh
pnpm eval --check --tasks evals/baseline
```

The check runs without model calls. It requires Docker and access to the npm registry during setup. The grader
installs dependencies from the unchanged fixture, cuts network access, then applies the candidate changes and
hidden tests. It confirms that each unchanged fixture fails hidden grading and that its reference solution passes.

For a measured comparison, a human runs each harness on the same fixture and instruction with the same model ID
and per-attempt budget. Give mini-SWE-agent only a fresh copy of each `repo/`, run the listed setup commands before
disconnecting its sandbox, and submit a unified git patch. Keep `hidden/` and `solution/` out of both run sandboxes.
Use one mini-SWE-agent version throughout and save its native v2 trajectories as `<task-id>.<attempt>.traj.json`,
including failed attempts. Keep trajectories outside the checkout. They can contain prompts and tool output.

Start Nanogent manually with a model key in the process environment:

```sh
pnpm eval --tasks evals/baseline --model claude-haiku-5-5 --max-cost 0.15 --repeat 3 \
  --out /path/to/nanogent
```

The report records a fingerprint over the fixture files, instructions, setup and hidden checks. After collecting both
sets of results, use the same flags to compare the saved report and the reference trajectories:

```sh
pnpm eval --tasks evals/baseline --model claude-haiku-5-5 --max-cost 0.15 --repeat 3 \
  --reference /path/to/trajectories --against /path/to/nanogent/report.json --out /path/to/comparison
```

Comparison uses the same hidden grader for submitted reference patches, matches task IDs and attempt numbers,
and checks the recorded model and budget. It writes paired results, verified success rate, model spend and cost per
verified pass to `comparison.json`. The comparison command makes no model calls. The operator must verify that both
harnesses used equivalent environments and pricing, since the reference trajectory does not prove which files it saw.
Two tasks are an initial baseline. Expand the suite before using results to rank models or harnesses.
