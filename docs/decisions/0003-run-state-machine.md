# 0003: Explicit run state machine

Legal transitions live in one frozen table and every pair is tested.

| From | To |
| --- | --- |
| queued | running, canceled |
| running | awaiting_approval, completed, failed, canceled |
| awaiting_approval | running, failed, canceled |
| completed, failed, canceled | nothing |

A queued run can be canceled before it starts. A run waiting for approval can fail (for example when its time limit runs
out) or be canceled without resuming. Setup failures go `running → failed`, because the executor enters `running` before
it provisions anything.

The agent submitting is not the same as the run completing: only the executor marks a run `completed`, and only after
the verify command passes. Retries create a new run.
