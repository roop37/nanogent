import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { HttpError } from "./guard";

export const githubCookie = "nanogent-github-oauth";
const flowLifetime = 600;
const configSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
  origin: z.url().refine((url) => {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.origin === url;
  }),
  key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export function githubConfig(env: Record<string, string | undefined> = process.env) {
  const raw = {
    slug: env.NANOGENT_GITHUB_APP_SLUG,
    clientId: env.NANOGENT_GITHUB_CLIENT_ID,
    clientSecret: env.NANOGENT_GITHUB_CLIENT_SECRET,
    origin: env.NANOGENT_GITHUB_ORIGIN,
    key: env.NANOGENT_GITHUB_TOKEN_KEY,
  };
  if (Object.values(raw).every((value) => value === undefined)) return null;
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(503, "GitHub connection is not configured.");
  return { ...parsed.data, key: Buffer.from(parsed.data.key, "base64url") };
}
export type GitHubConfig = NonNullable<ReturnType<typeof githubConfig>>;

export function seal(key: Buffer, scope: string, value: unknown) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(scope));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64url");
}

export function unseal(key: Buffer, scope: string, value: string): unknown {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
  );
}

const callback = (config: GitHubConfig) => `${config.origin}/api/github/callback`;
const random = () => randomBytes(32).toString("base64url");
const flowSchema = z.object({
  state: z.string().length(43),
  verifier: z.string().length(43),
  expires: z.number(),
});

export function beginGitHub(config: GitHubConfig, owner: string) {
  const flow = { state: random(), verifier: random(), expires: Date.now() + flowLifetime * 1000 };
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callback(config),
    state: flow.state,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url, value: seal(config.key, `github-flow:${owner}`, flow), maxAge: flowLifetime };
}

export function verifyGitHubState(
  config: GitHubConfig,
  owner: string,
  value: string,
  state: string,
) {
  try {
    const flow = flowSchema.parse(unseal(config.key, `github-flow:${owner}`, value));
    if (
      flow.expires > Date.now() &&
      Buffer.byteLength(state) === 43 &&
      timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))
    )
      return flow.verifier;
  } catch {
    // A changed session or expired connection flow must start again.
  }
  throw new HttpError(400, "GitHub connection expired. Try again.");
}

const token = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9_]+$/);
export const credentialsSchema = z.object({ access: token, refresh: token });
const tokenResponse = z.object({
  access_token: token,
  refresh_token: token,
  expires_in: z.int().positive().max(86_400),
});
export async function exchangeGitHub(
  config: GitHubConfig,
  grant: { code: string; verifier: string } | { refresh: string },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...("code" in grant
        ? { code: grant.code, code_verifier: grant.verifier, redirect_uri: callback(config) }
        : { grant_type: "refresh_token", refresh_token: grant.refresh }),
    }),
  });
  if (!response.ok) throw new HttpError(502, "Could not reach GitHub authorization.");
  const parsed = tokenResponse.safeParse(await response.json());
  if (!parsed.success) throw new HttpError(401, "Reconnect GitHub to continue.");
  return {
    credentials: { access: parsed.data.access_token, refresh: parsed.data.refresh_token },
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
  };
}
