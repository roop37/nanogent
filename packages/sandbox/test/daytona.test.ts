import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEventInput } from "@nanogent/core";
import { afterEach, expect, it, vi } from "vitest";
import { runtime } from "../../core/test/runtime.js";
import { type DaytonaClient, type DaytonaHandle, DaytonaSandboxProvider } from "../src/daytona.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
function setup(environment: "test" | "production" = "test") {
  const { spec: fullSpec } = runtime({
    repo: { url: "https://github.com/example/public.git" },
    setupCommands: ["npm install"],
  });
  const { id, repo, setupCommands, limits } = fullSpec;
  const spec = { id, repo, setupCommands, limits };
  const commands: string[] = [];
  const events: RunEventInput[] = [];
  const remote = {
    id: "fake-daytona",
    labels: { "nanogent.run": spec.id },
    createdAt: new Date(0).toISOString(),
    delete: vi.fn(async () => {}),
    updateNetworkSettings: vi.fn(async () => {}),
    fs: { uploadFile: vi.fn(async (_file: Buffer | string, _remotePath: string) => {}) },
    process: {
      executeCommand: vi.fn(async (command: string) => {
        const encoded = command.match(/(?:once|request) '([A-Za-z0-9+/=]+)'$/)?.[1];
        const request = encoded ? JSON.parse(Buffer.from(encoded, "base64").toString()) : undefined;
        if (request) commands.push(request.command ?? "restart");
        const result = {
          exitCode: 0,
          stdout: request?.command === "git rev-parse HEAD" ? "a".repeat(40) : "ok",
          stderr: "",
          timedOut: false,
          truncated: false,
        };
        return { exitCode: 0, result: request ? JSON.stringify(result) : "" };
      }),
      createSession: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      executeSessionCommand: vi.fn(async () => ({ cmdId: "cmd", output: "", exitCode: 0 })),
    },
  } satisfies DaytonaHandle;
  const client = {
    create: vi.fn(async () => remote),
    list: async function* () {
      yield remote;
    },
  } satisfies DaytonaClient;
  const options = {
    client,
    environment,
    events: {
      emit: async (event: RunEventInput) => {
        events.push(event);
      },
    },
  };
  return {
    spec,
    commands,
    events,
    remote,
    client,
    options,
    provider: new DaytonaSandboxProvider(options),
  };
}
it("sets lifecycle limits, clones without hooks/submodules, cuts network and records baseline", async () => {
  const { provider, spec, client, remote, commands } = setup();
  const sandbox = await provider.create(spec);
  expect(client.create).toHaveBeenCalledWith(
    expect.objectContaining({
      labels: { "nanogent.run": spec.id },
      autoStopInterval: 5,
      autoDeleteInterval: 0,
      ephemeral: true,
      public: false,
      ttlMinutes: 35,
    }),
    { timeout: 60 },
  );
  expect(commands[0]).toContain("--no-recurse-submodules -c core.hooksPath=/dev/null");
  expect(commands).toContain("npm install");
  expect(remote.updateNetworkSettings).toHaveBeenCalledWith({ networkBlockAll: true });
  expect(sandbox.baseline).toBe("a".repeat(40));
  await sandbox.diff({ maxBytes: 1000 });
  expect(commands.at(-1)).toContain("add -N .");
  expect(commands.at(-1)).toContain("--no-ext-diff --no-textconv --binary");
  await sandbox.destroy();
  await sandbox.destroy();
  expect(remote.delete).toHaveBeenCalledTimes(1);
});
it("allows only the documented restricted-tier error outside production and records the gap", async () => {
  const fake = setup();
  fake.remote.updateNetworkSettings.mockRejectedValue(
    Object.assign(
      new Error("Network access is restricted and cannot be overridden at the sandbox level"),
      { statusCode: 400 },
    ),
  );
  await (await fake.provider.create(fake.spec)).destroy();
  expect(fake.events).toContainEqual({
    type: "log",
    data: { level: "warn", message: expect.stringContaining("essential services") },
  });
  const strict = new DaytonaSandboxProvider({ ...fake.options, environment: "production" });
  await expect(strict.create(fake.spec)).rejects.toThrow("network isolation failed");
  fake.remote.updateNetworkSettings.mockRejectedValue(new Error("temporary"));
  await expect(fake.provider.create(fake.spec)).rejects.toThrow("network isolation failed");
  expect(fake.remote.delete).toHaveBeenCalledTimes(3);
});
it("honors an explicit fallback override and deletes sandboxes on setup failure", async () => {
  const fake = setup();
  fake.remote.updateNetworkSettings.mockRejectedValue(
    Object.assign(
      new Error("Network access is restricted and cannot be overridden at the sandbox level"),
      { statusCode: 400 },
    ),
  );
  await expect(
    new DaytonaSandboxProvider({ ...fake.options, allowRestrictedTierNetwork: false }).create(
      fake.spec,
    ),
  ).rejects.toThrow();
  expect(fake.remote.delete).toHaveBeenCalledTimes(1);
});
it("rejects credential-bearing URLs before creation and destroys a late creation after cancellation", async () => {
  const fake = setup();
  await expect(
    fake.provider.create({ ...fake.spec, repo: { url: "https://user:password@example.com/repo" } }),
  ).rejects.toThrow("credential-free");
  expect(fake.client.create).not.toHaveBeenCalled();
  const abort = new AbortController();
  fake.client.create.mockImplementationOnce(async () => {
    abort.abort();
    return fake.remote;
  });
  await expect(fake.provider.create(fake.spec, abort.signal)).rejects.toThrow();
  expect(fake.remote.delete).toHaveBeenCalledTimes(1);
});
it("uses a persistent session and recreates it when the transport times out", async () => {
  const fake = setup();
  const sandbox = await fake.provider.create(fake.spec);
  const options = { timeoutSec: 1, maxOutputBytes: 1000 };
  await sandbox.bash("export HELLO=world", options);
  await sandbox.bash("echo $HELLO", options);
  expect(fake.remote.process.createSession).toHaveBeenCalledTimes(1);
  fake.remote.process.executeCommand.mockRejectedValueOnce(new Error("client timeout"));
  expect(await sandbox.bash("sleep 10", options)).toMatchObject({
    timedOut: true,
    stdout: expect.stringContaining("restarted"),
  });
  expect(fake.remote.process.deleteSession).toHaveBeenCalledTimes(1);
  expect(fake.remote.process.createSession).toHaveBeenCalledTimes(2);
  await sandbox.destroy();
});
it("aborts an in-flight command by deleting the sandbox", async () => {
  const fake = setup();
  const sandbox = await fake.provider.create(fake.spec);
  const abort = new AbortController();
  fake.remote.process.executeCommand.mockImplementationOnce(() => new Promise(() => {}));
  const execution = sandbox.exec("sleep 10", {
    timeoutSec: 20,
    maxOutputBytes: 1000,
    signal: abort.signal,
  });
  abort.abort();
  await expect(execution).rejects.toThrow();
  expect(fake.remote.delete).toHaveBeenCalledTimes(1);
});
it("uploads local files without secret directories and rejects symlinks", async () => {
  const fake = setup();
  const dir = await mkdtemp(join(tmpdir(), "daytona-upload-"));
  dirs.push(dir);
  await writeFile(join(dir, "index.js"), "ok");
  await writeFile(join(dir, ".env"), "excluded");
  await mkdir(join(dir, ".git/modules/nested"), { recursive: true });
  await writeFile(join(dir, ".git/config"), "excluded");
  await writeFile(join(dir, ".git/modules/nested/config"), "excluded");
  await mkdir(join(dir, ".ssh"));
  await writeFile(join(dir, ".ssh/key"), "excluded");
  await (await fake.provider.create({ ...fake.spec, repo: { localPath: dir } })).destroy();
  const paths = fake.remote.fs.uploadFile.mock.calls.map((call) => call[1]);
  expect(paths).toContain("/home/daytona/workspace/index.js");
  expect(
    paths.some(
      (path) => path?.includes(".env") || path?.includes(".ssh") || path?.endsWith("/config"),
    ),
  ).toBe(false);
  await symlink("/etc/passwd", join(dir, "escape"));
  await expect(fake.provider.create({ ...fake.spec, repo: { localPath: dir } })).rejects.toThrow(
    "symlinks",
  );
});
it("GC deletes only old sandboxes with a valid run label", async () => {
  const fake = setup();
  const recent = {
    ...fake.remote,
    createdAt: new Date().toISOString(),
    delete: vi.fn(async () => {}),
  };
  const unrelated = { ...fake.remote, labels: {}, delete: vi.fn(async () => {}) };
  const provider = new DaytonaSandboxProvider({
    ...fake.options,
    client: {
      ...fake.client,
      list: async function* () {
        yield fake.remote;
        yield recent;
        yield unrelated;
      },
    },
  });
  expect(await provider.gc(60)).toBe(1);
  expect(fake.remote.delete).toHaveBeenCalledTimes(1);
  expect(recent.delete).not.toHaveBeenCalled();
  expect(unrelated.delete).not.toHaveBeenCalled();
});
