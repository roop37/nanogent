import "server-only";
import { z } from "zod";
import { commitSha, githubId, repositoryPath } from "../projects";
import { HttpError } from "./guard";

const id = z.int().positive().transform(String).pipe(githubId);
const login = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);
const fullName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/)
  .refine((name) => !/\/(?:\.|\.\.)$/.test(name));
const repository = z.object({
  id,
  full_name: fullName,
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
});
const installation = z.object({ id, account: z.object({ login }) });
const entry = z.object({
  name: z.string().max(255),
  path: repositoryPath,
  type: z.string().max(20),
});
const file = entry.extend({
  size: z.int().nonnegative(),
  encoding: z.string(),
  content: z.string().max(2_000_000),
});
export type GitHubRepository = z.infer<typeof repository>;

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "GitHub returned an empty response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new HttpError(502, "GitHub response is too large to load.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(502, "GitHub returned an invalid response.");
  }
}

export function github(access: string, fetcher: typeof fetch = fetch) {
  const deadline = AbortSignal.timeout(15_000);
  async function get<T>(path: string, schema: z.ZodType<T>, params: Record<string, string> = {}) {
    const url = new URL(`https://api.github.com${path}`);
    url.search = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
      });
    } catch {
      throw new HttpError(502, "Could not reach GitHub. Try again.");
    }
    if (response.status === 401) throw new HttpError(401, "Reconnect GitHub to continue.");
    if (
      response.status === 429 ||
      (response.headers.get("x-ratelimit-remaining") === "0" && !response.ok)
    )
      throw new HttpError(429, "GitHub rate limit reached. Try again later.");
    if (response.status === 403 || response.status === 404)
      throw new HttpError(404, "GitHub repository or path is unavailable.");
    if (response.status === 409)
      throw new HttpError(409, "This GitHub repository has no commits yet.");
    if (!response.ok) throw new HttpError(502, "GitHub could not complete the request.");
    const data = schema.safeParse(await boundedJson(response));
    if (!data.success) throw new HttpError(502, "GitHub returned an unexpected response.");
    return { data: data.data, next: response.headers.get("link")?.includes('rel="next"') ?? false };
  }

  function repos(installationId: string, page: number) {
    return get(
      `/user/installations/${githubId.parse(installationId)}/repositories`,
      z.object({ repositories: z.array(repository).max(100) }),
      { page: String(page), per_page: "100" },
    );
  }

  function repoPath(name: string) {
    return `/repos/${fullName.parse(name).split("/").map(encodeURIComponent).join("/")}`;
  }

  return {
    async viewer() {
      return (await get("/user", z.object({ login }))).data;
    },
    async installations() {
      const choices: z.infer<typeof installation>[] = [];
      for (let page = 1; page <= 10; page++) {
        const { data, next } = await get(
          "/user/installations",
          z.object({ installations: z.array(installation).max(100) }),
          { page: String(page), per_page: "100" },
        );
        choices.push(...data.installations);
        if (!next) return choices;
      }
      throw new HttpError(422, "Too many GitHub installations to load.");
    },
    repos,
    async authorizedRepos(installationId: string, selected: readonly string[]) {
      const found = new Map<string, GitHubRepository>();
      const needed = new Set(selected);
      for (let page = 1; page <= 30; page++) {
        const { data, next } = await repos(installationId, page);
        for (const repo of data.repositories) if (needed.has(repo.id)) found.set(repo.id, repo);
        if (found.size === needed.size) return selected.map((id) => repositoryView(found.get(id)));
        if (!next) throw new HttpError(404, "One or more repositories are no longer accessible.");
      }
      throw new HttpError(422, "Could not verify access to the selected repositories.");
    },
    async head(name: string, branch: string) {
      const { data } = await get(
        `${repoPath(name)}/commits`,
        z.array(z.object({ sha: commitSha })).max(1),
        { sha: branch, per_page: "1" },
      );
      if (!data[0]) throw new HttpError(409, "This GitHub repository has no commits yet.");
      return data[0].sha;
    },
    async content(name: string, sha: string, path: string) {
      const suffix = repositoryPath.parse(path).split("/").map(encodeURIComponent).join("/");
      const { data } = await get(
        `${repoPath(name)}/contents${suffix ? `/${suffix}` : ""}`,
        z.union([z.array(entry).max(1000), file, entry]),
        { ref: commitSha.parse(sha) },
      );
      if (Array.isArray(data)) return { entries: data, text: null };
      if (
        data.type !== "file" ||
        !("content" in data) ||
        data.size > 128 * 1024 ||
        data.encoding !== "base64"
      )
        return { entries: null, text: null };
      try {
        const bytes = Buffer.from(data.content, "base64");
        if (bytes.length !== data.size || bytes.includes(0)) return { entries: null, text: null };
        return { entries: null, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
      } catch {
        return { entries: null, text: null };
      }
    },
  };
}

function repositoryView(repo: GitHubRepository | undefined) {
  if (!repo) throw new HttpError(404, "GitHub repository is unavailable.");
  return repo;
}
