# Design

## Goal

Hand Nanogent a repository and a task. Get back a written result or a change that can be tested in a clean
environment, with enough of a record to understand how it got there. The browser workspace will let users review
and edit files, run tasks against their draft, and turn reviewed changes into a pull request.

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
| `evals` | Eval tasks, hidden-test grading, reports |
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

## Repository workspace

### Projects and sessions

After signing in, the user connects GitHub to enter the workspace. The repository picker lists personal and
organization repositories the user can access through the Nanogent GitHub App, with a way to configure access to
additional repositories. The user can import multiple repositories, create a GitHub repository explicitly, or reopen
an imported project. Each project identifies its repository, branch and base commit.

The sidebar lists projects. The header shows open sessions and their status, and the active session shows the
conversation and its results. Files and Source Control open alongside the session. Closing a tab keeps the session
available to reopen. Show the repository file tree and use a browser editor such as Monaco to edit files.

A project can have multiple sessions. Each session has a durable transcript and its own versioned draft. On a follow-up,
assemble the model context from that session. As the context window fills, retain the append-only transcript and use
a summary of earlier context for the new request. A run snapshots the session draft into a clean sandbox. It returns a
written result or a patch to review. Applying a patch checks the draft version and preserves both sets of changes when
there is a conflict. Users choose which changes to bring together in Source Control.

### Source Control

Show the base and work branch, changed files and diffs. Pull fetches remote changes and surfaces conflicts. Users
review and commit to a work branch, then explicitly push or open a PR. Check the remote head before publishing and
respect branch protections. The runner produces the result and patch. The web service authorizes GitHub writes and
records the user who requested them.

### Compute and security

The browser handles editing and review. Vercel handles the web requests, and Neon holds the run queue and durable
workspace state. The runner takes jobs from the queue and runs checkout, setup and verification in isolated sandboxes.
The configured model provider runs inference. Interactive terminals and app previews are outside the workspace scope.
An idle session uses storage. Only a run occupies a runner slot. Allow one active run per session, keep per-user and
runner limits, and schedule work fairly across users. The [hosted runner](architecture.md#hosted-execution) defaults to
two simultaneous runs. Measure queue wait, sandbox startup, CPU, peak memory, run duration and model spend before
raising concurrency.

Authorize project, session, file and artifact access on the server and recheck GitHub access before serving private
data or publishing. Keep short-lived repository credentials out of sandboxes, browser responses, prompts
and logs. Before enabling private repositories, verify sandbox isolation, setup network restrictions, disk limits,
cleanup and cross-account access on the deployed runner. Make the selected model provider's access to source and
tool output visible before submission. Set retention and deletion policies for drafts, transcripts and artifacts.
See the [security model](security.md) for current controls.

## Model selection

New Run shows enabled Anthropic models with their pricing and a separate budget. The workspace session composer will
also offer a provider choice as integrations are added. Record the model used for each run and the provider once there
is more than one. New providers must support the tool and budget contracts and pass the same verification checks as
the existing Claude integration.
