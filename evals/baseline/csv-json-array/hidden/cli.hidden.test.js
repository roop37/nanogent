import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("exports JSON and JSON Lines from the same CSV", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "csv-export-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "rows.csv");
  const cli = (...args) => spawnSync(process.execPath, ["cli.js", ...args], { encoding: "utf8" });
  await writeFile(path, 'name,id\n"Van, Al",001\n\nÉloïse,002\n');
  const expected = [
    { name: "Van, Al", id: "001" },
    { name: "Éloïse", id: "002" },
  ];
  const array = cli("--format", "json", path);
  assert.equal(array.status, 0, array.stderr);
  assert.equal(array.stdout, `${JSON.stringify(expected, null, 2)}\n`);
  assert.equal(cli(path).stdout, expected.map((row) => `${JSON.stringify(row)}\n`).join(""));
  assert.equal(cli("--format", "jsonl", path).stdout, cli(path).stdout);

  await writeFile(path, "name,id\n");
  assert.equal(cli("--format", "json", path).stdout, "[]\n");
  await writeFile(path, "name,id\nAda");
  const malformed = cli("--format", "json", path);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, "");
  const unsupported = cli("--format", "xml", join(dir, "missing.csv"));
  assert.equal(unsupported.status, 1);
  assert.equal(unsupported.stdout, "");
  assert.match(unsupported.stderr, /format/i);
  assert.doesNotMatch(unsupported.stderr, /ENOENT/);
});
