# Sandbox providers

`DockerSandboxProvider` uses `docker/Dockerfile`. `DaytonaSandboxProvider` uses the official SDK with an injected client
for tests. Pass the API key and environment explicitly; the provider does not load credential files.

The default Daytona snapshot already provides Node 24, git, Python 3, ripgrep and bash. The provider uploads its shell
and file helpers, then uses `/home/daytona/workspace`. No custom snapshot is required. Clone, setup, baseline, execution
and diff follow the same lifecycle as Docker. Uploaded local repositories retain Git objects and executable file bits,
but omit Git config and hooks; symlinks are rejected. Hosted workers accept public HTTPS repositories only.

Daytona sessions keep a Python bridge alive. Bash retains cwd and exports between calls. The wrapper enforces the
command timeout and byte cap inside the sandbox; a transport failure recreates the session. `destroy()` is idempotent,
and `gc(maxAgeSec)` removes old labelled sandboxes. The provider requests a five-minute idle auto-stop, immediate
auto-delete and a wall-clock TTL of the run limit plus five minutes.

After setup the provider blocks network access. Restricted-tier fallback is allowed by default only outside production;
see [security notes](../../docs/security.md). `allowRestrictedTierNetwork: false` always fails closed.

## Optional snapshot

A human with Daytona access can build a snapshot from the existing Dockerfile. From the repository root:

```sh
cd packages/sandbox/docker
daytona-v0 snapshot create nanogent-node24 --dockerfile ./Dockerfile
```

Current Daytona v0 CLI installations use `daytona-v0`. On older installations the equivalent command is
`daytona snapshot create nanogent-node24 --dockerfile ./Dockerfile`. See the
[CLI reference](https://www.daytona.io/docs/tools/cli) and [snapshot instructions](https://www.daytona.io/docs/snapshots/).
The command builds a snapshot; do not add credentials to the Dockerfile or build context.

To use it, construct the provider with `snapshot: "nanogent-node24"`, `user: "agent"`, and `workspace: "/workspace"`.
That matches the Dockerfile's user and directory. The worker intentionally uses Daytona's default snapshot today.

## Tests

```sh
pnpm --filter @nanogent/sandbox test
```

Daytona tests use a fake SDK client. The Python transport and file confinement tests run locally without service calls.
Docker integration tests remain available through `pnpm test:docker`.
