import "server-only";
import { z } from "zod";
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Session = { user: { id: string; name?: string; email?: string } } | null;
export function requireUser(session: Session) {
  const id = z.uuid().safeParse(session?.user.id);
  if (!id.success) throw new HttpError(401, "Sign in to continue.");
  return { id: id.data, name: session?.user.name ?? "Account", email: session?.user.email ?? "" };
}
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

// Compare against the host the browser actually used. `request.url` can carry a different host
// (localhost in dev, the deployment URL behind Vercel's proxy when a custom domain is used).
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    new URL(request.url).host;
  if (
    (origin && originHost(origin) !== host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
}
