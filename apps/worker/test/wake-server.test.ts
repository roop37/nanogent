import type { AddressInfo } from "node:net";
import { signWake, WAKE_HEADER } from "@nanogent/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWakeServer } from "../src/wake-server.js";

const secret = "w".repeat(32);
const servers: ReturnType<typeof createWakeServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(overrides: Partial<Parameters<typeof createWakeServer>[0]> = {}) {
  const onWake = vi.fn();
  const server = createWakeServer({ secret, onWake, ...overrides });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string, headers: Record<string, string> = {}, path = "/wake") =>
    fetch(base + path, { method: "POST", body, headers });
  return { onWake, base, post };
}

describe("wake server", () => {
  it("accepts a correctly signed wake-up", async () => {
    const { post, onWake } = await start();
    const body = '{"runId":"run_x"}';
    const response = await post(body, { [WAKE_HEADER]: signWake(secret, body) });
    expect(response.status).toBe(202);
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, wrong or stale signatures without waking", async () => {
    const { post, onWake } = await start();
    const body = "{}";
    expect((await post(body)).status).toBe(401);
    expect((await post(body, { [WAKE_HEADER]: signWake("x".repeat(32), body) })).status).toBe(401);
    expect(
      (await post(body, { [WAKE_HEADER]: signWake(secret, body, Date.now() - 120_000) })).status,
    ).toBe(401);
    expect((await post("{ }", { [WAKE_HEADER]: signWake(secret, body) })).status).toBe(401);
    expect(onWake).not.toHaveBeenCalled();
  });

  it("limits body size, paths and methods", async () => {
    const { post, base } = await start();
    const big = "x".repeat(5000);
    expect((await post(big, { [WAKE_HEADER]: signWake(secret, big) })).status).toBe(413);
    expect((await post("{}", {}, "/other")).status).toBe(404);
    expect((await fetch(`${base}/wake`)).status).toBe(405);
  });

  it("rate-limits accepted wake-ups", async () => {
    const { post, onWake } = await start({ maxPerSecond: 2, now: () => 1_000_000 });
    const body = "{}";
    const header = { [WAKE_HEADER]: signWake(secret, body, 1_000_000) };
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(body, header)).status);
    expect(statuses).toEqual([202, 202, 429, 429]);
    expect(onWake).toHaveBeenCalledTimes(2);
  });

  it("answers the health check", async () => {
    const { base } = await start();
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
