import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { convert } from "./convert.js";

try {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 1) throw new Error("Provide one CSV path");
  process.stdout.write(convert(await readFile(positionals[0], "utf8")));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
