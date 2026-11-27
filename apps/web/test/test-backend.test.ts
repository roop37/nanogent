import { createRunId, DEFAULT_LIMITS, RunSpecSchema } from "@nanogent/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "../lib/server/test-backend";

const owner = "00000000-0000-4000-8000-000000000002";
function setup() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NANOGENT_ENV", "test");
  vi.stubEnv("NANOGENT_WEB_TEST_MODE", "1");
  vi.stubEnv("VERCEL", "");
  const spec = RunSpecSchema.parse({
    id: createRunId(),
    repo: { url: "https://github.com/example/calc" },
    task: "Fix addition",
    model: "claude-haiku-5-5",
    effort: "medium",
    verifyCommand: "npm test",
    limits: DEFAULT_LIMITS,
  });
  return { spec, backend: fakeBackend() };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("scripted run progression", () => {
  it.each(
    Array.from({ length: 10 }, (_, i) => i + 1),
  )("replays reliably on attempt %s without advancing on page or list reads", async () => {
    vi.useFakeTimers();
    const { spec, backend } = setup();
    await backend.submit(spec, owner);
    vi.advanceTimersByTime(60 * 60 * 1000);
    await backend.list(owner);
    expect((await backend.get(owner, spec.id))?.state).toBe("running");
    const first = await backend.events(spec.id, 1);
    expect(first.events.at(-1)?.type).toBe("tool.call");
    const second = await backend.events(spec.id, first.nextSeq);
    expect(second.events.at(-1)?.type).toBe("tool.result");
    await backend.events(spec.id, second.nextSeq);
    expect((await backend.get(owner, spec.id))?.state).toBe("running");
    await backend.events(spec.id, second.nextSeq);
    expect((await backend.get(owner, spec.id))?.result?.verified).toBe(true);
    const replay = await backend.events(spec.id, 1);
    expect(new Set(replay.events.map((e) => e.seq)).size).toBe(replay.events.length);
    expect(replay.events.filter((e) => e.type === "verify.result")).toHaveLength(1);
    expect((await backend.events(spec.id, replay.nextSeq)).events).toEqual([]);
  });
  it("keeps cancellation final across later event polls", async () => {
    const { spec, backend } = setup();
    await backend.submit(spec, owner);
    await backend.cancel(spec.id);
    for (let i = 0; i < 6; i++) await backend.events(spec.id, 1);
    expect((await backend.get(owner, spec.id))?.state).toBe("canceled");
    expect((await backend.get(owner, spec.id))?.result).toBeUndefined();
  });
});
