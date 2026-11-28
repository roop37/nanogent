import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, type Session } from "./guard";
import { testMode } from "./settings";

let instance: ReturnType<typeof createNeonAuth> | undefined;
export function auth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret || secret.length < 32) throw new Error("Auth is not configured");
    instance = createNeonAuth({ baseUrl, cookies: { secret }, logLevel: "silent" });
  }
  return instance;
}
export async function getSession(): Promise<Session> {
  if (testMode()) {
    const value = (await cookies()).get("nanogent-test-session")?.value;
    const idSuffix = ["signed-in", "empty", "github", "github-sessions"].indexOf(value ?? "") + 1;
    return idSuffix
      ? {
          user: {
            id: `00000000-0000-4000-8000-00000000000${idSuffix}`,
            name: "Alex Morgan",
            email: "alex@example.com",
          },
        }
      : null;
  }
  const { data, error } = await auth().getSession();
  if (error) return null;
  return data;
}
export async function pageUser() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in");
  return requireUser(session);
}
