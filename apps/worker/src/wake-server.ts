import { createServer, type Server } from "node:http";
import { verifyWake, WAKE_HEADER } from "@nanogent/core";

export interface WakeServerOptions {
  secret: string;
  onWake(): void;
  /** At most this many accepted wake-ups per second, counted across all callers. */
  maxPerSecond?: number;
  now?(): number;
}

const MAX_BODY_BYTES = 2048;

/**
 * Tiny HTTP endpoint the web app calls after saving a run. A wake-up carries no data the runner trusts:
 * it only makes the runner look in the database now instead of at its next sweep.
 */
export function createWakeServer(options: WakeServerOptions): Server {
  const limit = options.maxPerSecond ?? 5;
  const now = options.now ?? Date.now;
  let windowStart = 0;
  let count = 0;

  return createServer((request, response) => {
    const reply = (status: number, text = "") => {
      response.writeHead(status, { "content-type": "text/plain", "content-length": text.length });
      response.end(text);
    };
    if (request.method === "GET" && request.url === "/healthz") return reply(200, "ok");
    if (request.url !== "/wake") return reply(404);
    if (request.method !== "POST") return reply(405);

    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return reply(413);
      const body = Buffer.concat(chunks).toString("utf8");
      const header = request.headers[WAKE_HEADER];
      if (!verifyWake(options.secret, Array.isArray(header) ? header[0] : header, body, now()))
        return reply(401);
      const time = now();
      if (time - windowStart >= 1000) {
        windowStart = time;
        count = 0;
      }
      if (++count > limit) return reply(429);
      options.onWake();
      reply(202);
    });
    request.on("error", () => reply(400));
  });
}
