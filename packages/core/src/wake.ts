import { createHmac, timingSafeEqual } from "node:crypto";

/** Header carrying the signature of a wake-up request from the web app to a runner. */
export const WAKE_HEADER = "x-nanogent-signature";
const TOLERANCE_SECONDS = 60;
export const MIN_WAKE_SECRET_LENGTH = 32;

function mac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** `t=<unix seconds>,v1=<hex hmac>` over `<t>.<body>`. */
export function signWake(secret: string, body: string, nowMs: number = Date.now()): string {
  const timestamp = Math.floor(nowMs / 1000);
  return `t=${timestamp},v1=${mac(secret, timestamp, body)}`;
}

export function verifyWake(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowMs: number = Date.now(),
): boolean {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(Math.floor(nowMs / 1000) - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(mac(secret, timestamp, body), "hex");
  const given = Buffer.from(match[2] as string, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
