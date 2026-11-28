import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { beginGitHub, githubCookie } from "@/lib/server/github-auth";
import { HttpError, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { projectConfig } from "@/lib/server/project-runtime";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    const config = projectConfig();
    if (!config) throw new HttpError(503, "GitHub connection is not configured.");
    if ((request.headers.get("origin") ?? new URL(request.url).origin) !== config.origin)
      return NextResponse.redirect(`${config.origin}/projects`, 303);
    const flow = beginGitHub(config, user.id);
    const response = NextResponse.redirect(flow.url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(githubCookie, flow.value, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/api/github/callback",
      maxAge: flow.maxAge,
    });
    return response;
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not connect GitHub." },
      {
        status: error instanceof HttpError ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
