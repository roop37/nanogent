import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { exchangeGitHub, githubCookie, seal, verifyGitHubState } from "@/lib/server/github-auth";
import { requireUser } from "@/lib/server/guard";
import { projectConfig, projectGitHub } from "@/lib/server/project-runtime";
import { connectionScope, withProjectStore } from "@/lib/server/project-store";
import { testMode } from "@/lib/server/settings";

export async function GET(request: NextRequest) {
  let origin = request.nextUrl.origin;
  let connected = false;
  try {
    const config = projectConfig();
    if (config) origin = config.origin;
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const flow = request.cookies.get(githubCookie)?.value;
    if (config && !testMode() && code && code.length <= 200 && state && flow) {
      const user = requireUser(await getSession());
      const verifier = verifyGitHubState(config, user.id, flow, state);
      const { credentials, expiresAt } = await exchangeGitHub(config, { code, verifier });
      const { login } = await projectGitHub(credentials.access).viewer();
      await withProjectStore((store) =>
        store.connect({
          ownerId: user.id,
          login,
          credentials: seal(config.key, connectionScope(user.id), credentials),
          expiresAt,
        }),
      );
      connected = true;
    }
  } catch {
    // The callback URL contains a one-time code. Do not expose it in errors or redirects.
  }
  const response = NextResponse.redirect(
    `${origin}/projects${connected ? "" : "?connection=failed"}`,
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(githubCookie, "", {
    path: "/api/github/callback",
    maxAge: 0,
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax",
  });
  return response;
}
