import { RunResultSchema, RunSpecSchema } from "@nanogent/core";
import { describe, expect, it } from "vitest";
import {
  authFailure,
  emailError,
  nextPath,
  parseProviders,
  socialError,
} from "../lib/auth-options";
import { demoDiff, demoRuns } from "../lib/server/demo-runs";
import {
  closeDestination,
  filterRuns,
  groupRuns,
  paletteMatch,
  readTabs,
  relativeTime,
  tabReducer,
} from "../lib/workspace";

const now = Date.parse("2026-11-26T12:00:00Z");
describe("sign-in options", () => {
  it("defaults, trims, deduplicates and allows disabling providers", () => {
    expect(parseProviders()).toEqual(["google", "github"]);
    expect(parseProviders(" github, google,github , ")).toEqual(["github", "google"]);
    expect(parseProviders("")).toEqual([]);
    expect(() => parseProviders("github,facebook")).toThrow("Invalid auth provider");
  });
  it("allows only same-origin relative return paths", () => {
    for (const path of [
      undefined,
      "",
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/%2fevil.test",
      "/%5cevil.test",
      "/%0a/evil.test",
      "/\t/evil.test",
      "/%zz",
    ])
      expect(nextPath(path)).toBe("/");
    expect(nextPath("/runs/new?repo=example#task")).toBe("/runs/new?repo=example#task");
  });
  it("does not show raw provider errors", () => {
    expect(socialError("PROVIDER_NOT_FOUND", "github")).toBe("GitHub sign-in isn't set up yet");
    expect(socialError("access_denied")).toBe("Sign-in was cancelled");
    expect(socialError("internal details")).toBe("Something went wrong, try again");
  });
});
describe("run navigation", () => {
  const runs = demoRuns(now);
  it("groups active runs regardless of date and history by UTC day", () => {
    const groups = groupRuns(runs, now);
    expect(groups.active.map((r) => r.state)).toEqual(["running", "queued", "awaiting_approval"]);
    expect(groups.today).toHaveLength(2);
    expect(groups.earlier).toHaveLength(3);
    expect(groupRuns(runs, now + 86400000).today).toHaveLength(0);
  });
  it("formats time boundaries and future timestamps", () => {
    for (const [seconds, label] of [
      [0, "just now"],
      [59, "just now"],
      [60, "1m ago"],
      [3599, "59m ago"],
      [3600, "1h ago"],
      [86400, "1d ago"],
      [-60, "just now"],
    ] as const)
      expect(relativeTime(new Date(now - seconds * 1000).toISOString(), now)).toBe(label);
    expect(relativeTime("bad", now)).toBe("—");
  });
  it("matches task, repository and id with fuzzy subsequences", () => {
    expect(filterRuns(runs, "crsr pgn")[0]?.spec.task).toContain("cursor pagination");
    expect(filterRuns(runs, "acme/cli")).toHaveLength(3);
    expect(filterRuns(runs, runs[0]?.spec.id ?? "")).toContain(runs[0]);
    expect(filterRuns(runs, "zzz-nothing")).toEqual([]);
    expect(paletteMatch("New run", "nw rn")).toBe(true);
  });
  it("opens unique tabs, updates titles, closes to neighbours and tolerates invalid storage", () => {
    const first = { href: "/runs/new", title: "New run" };
    const second = { href: `/runs/${runs[0]?.spec.id}`, title: "Working" };
    let tabs = tabReducer([], { type: "open", tab: first });
    tabs = tabReducer(tabs, { type: "open", tab: second });
    tabs = tabReducer(tabs, { type: "open", tab: { ...second, title: "Done" } });
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.title).toBe("Done");
    expect(closeDestination(tabs, first.href)).toBe(second.href);
    expect(closeDestination(tabs, second.href)).toBe(first.href);
    expect(closeDestination([first], first.href)).toBe("/");
    expect(tabReducer(tabs, { type: "close", href: second.href })).toEqual([first]);
    expect(readTabs(JSON.stringify(tabs))).toEqual(tabs);
    for (const value of [null, "bad", "{}", '[{"href":"//evil.test","title":"bad"}]'])
      expect(readTabs(value)).toEqual([]);
  });
  it("provides all demo states and a verified three-file diff", () => {
    expect(runs).toHaveLength(8);
    for (const run of runs) {
      expect(RunSpecSchema.safeParse(run.spec).success).toBe(true);
      if (run.result) expect(RunResultSchema.safeParse(run.result).success).toBe(true);
    }
    expect(demoDiff.match(/^diff --git/gm)).toHaveLength(3);
    expect(demoDiff.split("\n").length).toBeGreaterThanOrEqual(60);
  });
});

describe("sign-in error messages", () => {
  it("reads the code and status from thrown and returned SDK errors", () => {
    expect(authFailure({ code: "X", status: 401 })).toEqual({ code: "X", status: 401 });
    expect(authFailure({ error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 } })).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      status: 401,
    });
    expect(authFailure(new TypeError("Failed to fetch"))).toEqual({ code: "" });
    expect(authFailure(undefined)).toEqual({ code: "" });
  });
  it("tells a wrong password from a network failure", () => {
    expect(emailError({ code: "INVALID_EMAIL_OR_PASSWORD" }, false)).toBe(
      "Email or password is incorrect.",
    );
    expect(emailError({ code: "", status: 401 }, false)).toBe("Email or password is incorrect.");
    expect(emailError({ code: "" }, false)).toBe("Could not connect. Try again shortly.");
    expect(emailError({ code: "USER_ALREADY_EXISTS", status: 422 }, true)).toContain(
      "Could not create your account",
    );
    expect(emailError({ code: "EMAIL_NOT_VERIFIED", status: 403 }, false)).toContain(
      "verify your email",
    );
  });
});
