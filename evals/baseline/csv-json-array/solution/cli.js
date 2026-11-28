import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { convert } from "./convert.js";

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { format: { type: "string", default: "jsonl" } },
  });
  if (!["json", "jsonl"].includes(values.format)) throw new Error("Format must be json or jsonl");
  if (positionals.length !== 1) throw new Error("Provide one CSV path");
  process.stdout.write(convert(await readFile(positionals[0], "utf8"), values.format));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
