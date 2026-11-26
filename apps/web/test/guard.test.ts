import { describe, expect, it } from "vitest";
import { requireSameOrigin } from "../lib/server/guard";

function request(headers: Record<string, string>, url = "http://localhost:3000/api/runs") {
  return new Request(url, { method: "POST", headers });
}

describe("requireSameOrigin", () => {
  it("accepts the origin the browser used even when request.url has another host", () => {
    expect(() =>
      requireSameOrigin(request({ origin: "http://127.0.0.1:3199", host: "127.0.0.1:3199" })),
    ).not.toThrow();
  });

  it("uses the forwarded host behind a proxy", () => {
    expect(() =>
      requireSameOrigin(
        request(
          { origin: "https://nanogent.example.com", "x-forwarded-host": "nanogent.example.com" },
          "https://nanogent-abc123.vercel.app/api/runs",
        ),
      ),
    ).not.toThrow();
  });

  it("rejects a different origin", () => {
    expect(() =>
      requireSameOrigin(request({ origin: "https://evil.example", host: "nanogent.example.com" })),
    ).toThrow(/origin is not allowed/);
  });

  it("rejects a malformed origin and cross-site fetches", () => {
    expect(() => requireSameOrigin(request({ origin: "null", host: "a.example" }))).toThrow();
    expect(() =>
      requireSameOrigin(request({ "sec-fetch-site": "cross-site", host: "a.example" })),
    ).toThrow();
  });

  it("allows requests without an Origin header (same-origin GETs, server calls)", () => {
    expect(() => requireSameOrigin(request({ host: "a.example" }))).not.toThrow();
  });
});
