import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { repositoryPath } from "../lib/projects";
import { github } from "../lib/server/github";
import {
  beginGitHub,
  exchangeGitHub,
  type GitHubConfig,
  seal,
  unseal,
  verifyGitHubState,
} from "../lib/server/github-auth";

const config: GitHubConfig = {
  slug: "nanogent-test",
  origin: "https://example.invalid",
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  key: Buffer.alloc(32),
};

it("binds GitHub OAuth state and encrypted credentials to the signed-in owner", async () => {
  const { url, value } = beginGitHub(config, "owner");
  const state = url.searchParams.get("state") ?? "";
  expect(url.searchParams.get("redirect_uri")).toBe("https://example.invalid/api/github/callback");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const verifier = verifyGitHubState(config, "owner", value, state);
  expect(url.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  expect(() => verifyGitHubState(config, "different-owner", value, state)).toThrow("expired");
  expect(() => verifyGitHubState(config, "owner", value, "a".repeat(43))).toThrow("expired");

  const issued = await exchangeGitHub(
    config,
    { code: "fixture", verifier },
    async (input, init) => {
      expect(String(input)).toBe("https://github.com/login/oauth/access_token");
      expect((init?.body as URLSearchParams).get("code_verifier")).toBe(verifier);
      return Response.json({
        access_token: "fixture_access",
        refresh_token: "fixture_refresh",
        expires_in: 28800,
      });
    },
  );
  const stored = seal(config.key, "github-credentials:owner", issued.credentials);
  expect(stored).not.toContain("fixture_access");
  expect(unseal(config.key, "github-credentials:owner", stored)).toEqual(issued.credentials);
  expect(() => unseal(config.key, "github-credentials:other", stored)).toThrow();
});

it("checks all selected repositories against the installation, including later pages", async () => {
  const pages: string[] = [];
  const client = github("fixture_access", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe("https://api.github.com");
    expect(url.pathname).toBe("/user/installations/7/repositories");
    expect(init?.redirect).toBe("error");
    const page = url.searchParams.get("page") ?? "";
    pages.push(page);
    return Response.json(
      {
        repositories: [
          {
            id: page === "1" ? 10 : 11,
            full_name: "example/calc",
            private: true,
            default_branch: "main",
          },
        ],
      },
      page === "1" ? { headers: { Link: '<https://example.invalid>; rel="next"' } } : {},
    );
  });
  expect(await client.authorizedRepos("7", ["11", "10"])).toMatchObject([
    { id: "11" },
    { id: "10" },
  ]);
  expect(pages).toEqual(["1", "2"]);
  await expect(client.authorizedRepos("7", ["999"])).rejects.toMatchObject({ status: 404 });
});

it("bounds repository paths and uses the pinned commit for text previews", async () => {
  for (const path of ["../outside", "/absolute", "src//a", "a\\b", "x/./y", "x\u0000y"])
    expect(repositoryPath.safeParse(path).success).toBe(false);
  const pinned = "a".repeat(40);
  const bytes = Buffer.from("<script>untrusted</script>\n");
  const client = github("fixture_access", async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.pathname).toBe("/repos/example/calc/contents/docs/hello%20world.md");
    expect(url.searchParams.get("ref")).toBe(pinned);
    return Response.json({
      name: "hello world.md",
      path: "docs/hello world.md",
      type: "file",
      size: bytes.length,
      encoding: "base64",
      content: bytes.toString("base64"),
    });
  });
  expect(await client.content("example/calc", pinned, "docs/hello world.md")).toEqual({
    entries: null,
    text: bytes.toString(),
  });
});
