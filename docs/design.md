# Design

## Goal

Hand Nanogent a repository and a task; get back a change that has been tested in a clean environment, plus enough of a
record to understand how it got there. Later: run it from a browser and turn the result into a pull request after a
human has looked at it.

## Ground rules

- Build one working path end to end before adding the next layer.
- Modules talk through small interfaces. The controller doesn't know how a sandbox is made or which model is used.
- Repository content, model output and tool input are untrusted. Safety lives in code, not in the prompt.
- The agent saying it's done doesn't count. The harness runs the verification command itself.
- Every run has hard limits. Cost is part of the design, not a billing afterthought.
- Doing the work and recording it are separate: modules emit events, and anything that displays a run reads events.

## Modules

| Package | Job |
| --- | --- |
| `core` | Schemas, run state machine, events, budget, interfaces |
| `config` | Environment, model defaults, pricing |
| `brain` | The agent loop against the Claude Messages API |
| `harness` | Tools, permission policy, executor (setup → agent → verify → teardown) |
| `sandbox` | Docker sandbox provider; later a hosted one |
| `store` | Run storage, JSONL on disk for now |
| `controller` | Submit, cancel, approve, watch |
| `apps/cli` | The `nanogent` command |

Run states: `queued → running → completed | failed | canceled`, with `running ↔ awaiting_approval` for actions that need
a human. Terminal states are final; a retry is a new run.

## Agent loop

We own the loop rather than using an SDK agent runner, because the loop is where limits, permissions and accounting are
enforced. It streams responses, keeps history append-only (assistant content is sent back unchanged), and handles each
stop reason explicitly. The model gets Anthropic's built-in `bash` and text editor tools, which it is trained on, plus a
`submit` tool. Tool input is validated before anything runs, and the budget is checked after every response and tool call.

## Measuring it

Public coding benchmarks are useful as a sanity check but have known contamination problems, so they are not the target.
The real measure is our own task suite: fixed repositories at pinned commits, hidden tests run by the harness in a fresh
sandbox, and a reference harness (mini-SWE-agent) run with the same model and budget for comparison.

The number we watch most is **verified successful tasks per dollar**, always next to the plain success rate.

Rough targets:

| | First hosted version | Production |
| --- | --- | --- |
| Easy tasks solved | 70% | 90% |
| Medium tasks solved | 40% | 70% |
| Sandbox start (p95) | 30 s | 15 s |
| Leaked sandboxes | cleaned up eventually | cleaned up within policy |
| Forbidden actions blocked in security tests | all | all |

## Later

Hosted version: Next.js dashboard, Postgres (Neon) for runs and events, Trigger.dev for long-running jobs, Daytona for
sandboxes, sign-in with Better Auth. Then GitHub integration with an approval step before any pull request is opened.
