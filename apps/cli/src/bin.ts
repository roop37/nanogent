#!/usr/bin/env node
import { redact } from "@nanogent/core";
import { runCli } from "./index.js";

const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());
try {
  process.exitCode = await runCli(process.argv.slice(2), { signal: abort.signal });
} catch (error) {
  const message = error instanceof Error ? error.message : "Command failed";
  const key = process.env.NANOGENT_ANTHROPIC_API_KEY;
  process.stderr.write(`${redact(key ? message.replaceAll(key, "[REDACTED]") : message)}\n`);
  process.exitCode = 1;
}
