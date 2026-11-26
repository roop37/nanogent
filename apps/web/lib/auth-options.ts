import { z } from "zod";

const Provider = z.enum(["github", "google"]);
export type AuthProvider = z.infer<typeof Provider>;
export function parseProviders(value = "google,github"): AuthProvider[] {
  const parsed = z.array(Provider).safeParse(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (!parsed.success) throw new Error("Invalid auth provider configuration");
  return [...new Set(parsed.data)];
}
export function nextPath(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded.startsWith("//") ||
      /[\\\s]/u.test(decoded) ||
      [...decoded].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      return "/";
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/";
    return value;
  } catch {
    return "/";
  }
}
export function socialError(code: string, provider?: AuthProvider) {
  if (/cancel|access_denied|user_denied/i.test(code)) return "Sign-in was cancelled";
  if (/provider.*(not|disabled)|not.*provider|invalid_client/i.test(code))
    return `${provider === "google" ? "Google" : provider === "github" ? "GitHub" : "Social"} sign-in isn't set up yet`;
  return "Something went wrong, try again";
}

/** What a failed sign-in call told us. The SDK throws for HTTP errors and returns `{ error }` for others. */
export function authFailure(error: unknown): { code: string; status?: number } {
  if (typeof error !== "object" || error === null) return { code: "" };
  const e = error as {
    code?: unknown;
    status?: unknown;
    error?: { code?: unknown; status?: unknown };
  };
  const code = e.error?.code ?? e.code;
  const status = e.error?.status ?? e.status;
  return {
    code: typeof code === "string" ? code : "",
    ...(typeof status === "number" && { status }),
  };
}

/** Message for a failed email sign-in or sign-up. `status` is only set when the server answered. */
export function emailError(failure: { code: string; status?: number }, signUp: boolean): string {
  if (failure.code === "INVALID_EMAIL_OR_PASSWORD" || (!signUp && failure.status === 401))
    return "Email or password is incorrect.";
  if (failure.status === undefined && failure.code === "")
    return "Could not connect. Try again shortly.";
  return signUp
    ? "Could not create your account. Check your details and try again."
    : "Could not sign in. Check your details or verify your email.";
}
