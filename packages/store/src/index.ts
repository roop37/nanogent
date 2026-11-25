import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  assertTransition,
  type RunEvent,
  RunEventSchema,
  RunIdSchema,
  type RunRecord,
  type RunSpec,
  RunSpecSchema,
  type RunState,
  type RunStore,
  redact,
} from "@nanogent/core";

export class JsonlRunStore implements RunStore {
  #pending = new Map<string, Promise<unknown>>();
  constructor(
    readonly home: string,
    private readonly secrets: readonly string[] = [],
  ) {}
  private directory(id: string) {
    return join(this.home, "runs", RunIdSchema.parse(id));
  }
  private clean(value: unknown): unknown {
    if (typeof value === "string") {
      let text = value;
      for (const secret of this.secrets) if (secret) text = text.replaceAll(secret, "[REDACTED]");
      return redact(text);
    }
    if (Array.isArray(value)) return value.map((entry) => this.clean(entry));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.clean(entry)]),
      );
    return value;
  }
  private serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.#pending.set(id, next);
    void next
      .finally(() => {
        if (this.#pending.get(id) === next) this.#pending.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async create(spec: RunSpec): Promise<void> {
    const valid = RunSpecSchema.parse(this.clean(RunSpecSchema.parse(spec)));
    const dir = this.directory(valid.id);
    await mkdir(join(this.home, "runs"), { recursive: true, mode: 0o700 });
    await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, "spec.json"), JSON.stringify(valid, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(join(dir, "events.jsonl"), "", { mode: 0o600, flag: "wx" });
  }
  async append(event: RunEvent): Promise<void> {
    const valid = RunEventSchema.parse(this.clean(RunEventSchema.parse(event)));
    await this.serialize(valid.runId, () => this.appendUnlocked(valid));
  }
  private async appendUnlocked(event: RunEvent): Promise<void> {
    const record = await this.get(event.runId);
    if (!record) throw new Error("Run not found");
    let last = 0;
    for await (const prior of this.events(event.runId)) last = prior.seq;
    if (event.seq !== last + 1) throw new Error("Event sequence must be contiguous");
    if (event.type === "run.state_changed") {
      if (record.state !== event.data.from) throw new Error("Stale state transition");
      assertTransition(record.state, event.data.to);
    }
    if (["completed", "failed", "canceled"].includes(record.state))
      throw new Error("Run is terminal");
    if (event.type === "run.result" && record.result) throw new Error("Run already has a result");
    const dir = this.directory(event.runId);
    await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
    if (event.type === "run.result") {
      await writeFile(join(dir, "result.json.tmp"), JSON.stringify(event.data, null, 2), {
        mode: 0o600,
      });
      await rename(join(dir, "result.json.tmp"), join(dir, "result.json"));
      await writeFile(join(dir, "diff.patch"), event.data.diff, { mode: 0o600 });
    }
  }
  async setState(runId: string, state: RunState): Promise<void> {
    await this.serialize(runId, async () => {
      const record = await this.get(runId);
      if (!record) throw new Error("Run not found");
      assertTransition(record.state, state);
      let seq = 0;
      for await (const event of this.events(runId)) seq = event.seq;
      await this.appendUnlocked(
        RunEventSchema.parse({
          runId,
          seq: seq + 1,
          ts: new Date().toISOString(),
          type: "run.state_changed",
          data: { from: record.state, to: state },
        }),
      );
    });
  }
  async get(runId: string): Promise<RunRecord | undefined> {
    let content: string;
    try {
      content = await readFile(join(this.directory(runId), "spec.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const record: RunRecord = { spec: RunSpecSchema.parse(JSON.parse(content)), state: "queued" };
    for await (const event of this.events(runId)) {
      if (event.type === "run.state_changed") {
        if (event.data.from !== record.state) throw new Error("Corrupt state history");
        assertTransition(record.state, event.data.to);
        record.state = event.data.to;
      }
      if (event.type === "run.result") record.result = event.data;
    }
    return record;
  }
  async *events(runId: string, fromSeq = 1): AsyncIterable<RunEvent> {
    if (!Number.isInteger(fromSeq) || fromSeq < 1) throw new Error("Invalid event cursor");
    const stream = createReadStream(join(this.directory(runId), "events.jsonl"), {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let previous = 0;
    try {
      for await (const line of lines) {
        if (!line) continue;
        const event = RunEventSchema.parse(JSON.parse(line));
        if (event.runId !== runId || event.seq !== previous + 1)
          throw new Error("Corrupt event sequence");
        previous = event.seq;
        if (event.seq >= fromSeq) yield event;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  async list(): Promise<RunRecord[]> {
    let ids: string[];
    try {
      ids = await readdir(join(this.home, "runs"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: RunRecord[] = [];
    for (const id of ids.sort().reverse()) {
      if (!RunIdSchema.safeParse(id).success) continue;
      const record = await this.get(id);
      if (record) records.push(record);
    }
    return records;
  }
}
