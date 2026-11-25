import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { DockerSandbox, DockerSandboxProvider, quote } from "../src/index.js";

const shell = fileURLToPath(new URL("../docker/shell.py", import.meta.url));
async function commands(requests: object[]) {
  const child = execFile("python3", [shell], { maxBuffer: 300_000 });
  const output = new Promise<string>((resolve, reject) => {
    let text = "";
    let errors = "";
    child.stdout?.on("data", (chunk) => {
      text += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(text) : reject(new Error(errors))));
  });
  child.stdin?.end(
    requests.map((r) => JSON.stringify({ maxOutputBytes: 1000, timeoutSec: 1, ...r })).join("\n") +
      "\n",
  );
  return (await output)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
it("preserves bash state and honors explicit restart", async () => {
  const output = await commands([
    { command: "export NANOGENT_TEST_VALUE=kept; cd /tmp" },
    { command: 'printf "%s:%s" "$NANOGENT_TEST_VALUE" "$PWD"' },
    { restart: true },
    { command: 'printf "%s" "$NANOGENT_TEST_VALUE"' },
  ]);
  expect(output[1].stdout).toBe("kept:/tmp");
  expect(output[2].stdout).toContain("restarted");
  expect(output[3].stdout).toBe("");
});
it("kills and restarts a timed-out shell and handles exit", async () => {
  const output = await commands([
    { command: "while :; do :; done", timeoutSec: 0.03 },
    { command: "printf alive" },
    { command: "exit 9" },
    { command: "printf recovered" },
  ]);
  expect(output[0]).toMatchObject({ timedOut: true, exitCode: null });
  expect(output[0].stdout).toContain("restarted");
  expect(output[1].stdout).toBe("alive");
  expect(output[2].stdout).toContain("restarted");
  expect(output[3].stdout).toBe("recovered");
});
it("caps output during collection and retains head and tail", async () => {
  const [output] = await commands([
    { command: 'python3 -c \'print("HEAD" + "x" * 1000000 + "TAIL")\'', maxOutputBytes: 100 },
  ]);
  expect(output.truncated).toBe(true);
  expect(output.stdout).toContain("HEAD");
  expect(output.stdout).toContain("TAIL");
  expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(100);
});
it("quotes shell metacharacters literally", async () => {
  const value = "' ; $(printf unsafe) `pwd`\ntext";
  const { stdout } = await promisify(execFile)("bash", ["-c", `printf %s ${quote(value)}`]);
  expect(stdout).toBe(value);
});
it("validates resource identifiers and GC ages before calling Docker", async () => {
  expect(() => new DockerSandbox("../../bad")).toThrow();
  await expect(new DockerSandboxProvider().gc(-1)).rejects.toThrow("Invalid GC");
});
