# 0004: Docker sandbox with a setup phase

Agent commands never run on the host. Each run gets its own container: non-root user, all capabilities dropped,
`no-new-privileges`, read-only root filesystem with a writable `/workspace` and tmpfs `/tmp`, and limits on CPU, memory
and process count. Containers are labelled `nanogent.run=<id>` so `nanogent gc` can find leftovers.

Network is only available during setup (clone and dependency install). After that the container is disconnected, so the
agent and the verify step run offline. A baseline commit is made after setup and the diff is taken against it, including
new files.

The shell tool keeps one bash session per run. A command that times out kills the session and the next call starts a
fresh one; the tool result says so.

The same `SandboxProvider` interface will back a hosted provider later.
