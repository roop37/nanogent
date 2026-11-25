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

The current set is small and easy. It is a smoke test for the harness, not a benchmark; harder multi-step tasks are next.
