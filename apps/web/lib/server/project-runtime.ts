import "server-only";
import { github } from "./github";
import { type GitHubConfig, githubConfig } from "./github-auth";
import { HttpError } from "./guard";
import { withProjectStore } from "./project-store";
import { testMode } from "./settings";

export function projectConfig(): GitHubConfig | null {
  if (!testMode()) return githubConfig();
  return {
    slug: "nanogent-test",
    origin: "http://127.0.0.1:3199",
    clientId: "test",
    clientSecret: "test",
    key: Buffer.alloc(32),
  };
}

const demoSha = "0123456789abcdef0123456789abcdef01234567";
const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const path = url.pathname;
  if (path === "/user/installations")
    return Response.json({ installations: [{ id: 7, account: { login: "example" } }] });
  if (path === "/user/installations/7/repositories")
    return Response.json({
      repositories: [
        { id: 10, full_name: "example/calc", private: true, default_branch: "main" },
        { id: 11, full_name: "example/notes", private: false, default_branch: "main" },
      ],
    });
  if (/^\/repos\/example\/(calc|notes)\/commits$/.test(path))
    return Response.json([{ sha: demoSha }]);
  if (
    /^\/repos\/example\/(calc|notes)\/contents$/.test(path) &&
    url.searchParams.get("ref") === demoSha
  )
    return Response.json([{ name: "README.md", path: "README.md", type: "file" }]);
  if (
    /^\/repos\/example\/(calc|notes)\/contents\/README\.md$/.test(path) &&
    url.searchParams.get("ref") === demoSha
  ) {
    const file = Buffer.from("# Fixture\nThis file was read from the pinned commit.\n");
    return Response.json({
      name: "README.md",
      path: "README.md",
      type: "file",
      size: file.length,
      encoding: "base64",
      content: file.toString("base64"),
    });
  }
  return Response.json({}, { status: 404 });
};

export function projectGitHub(access: string) {
  return github(access, testMode() ? fixtureFetch : fetch);
}

export async function projectConnection(owner: string, config: GitHubConfig) {
  const access = await withProjectStore((store) => store.access(owner, config));
  if (!access) throw new HttpError(401, "Connect GitHub to continue.");
  return { login: access.login, client: projectGitHub(access.token) };
}
