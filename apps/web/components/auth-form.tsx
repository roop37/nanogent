"use client";
import { Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  type AuthProvider,
  authFailure,
  emailError,
  nextPath,
  socialError,
} from "@/lib/auth-options";
import { ProviderIcon } from "./provider-icon";
import { TerminalDemo } from "./terminal-demo";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/primitives";
export function AuthForm({
  signUp = false,
  providers,
  next,
  initialError,
  errorProvider,
}: {
  signUp?: boolean;
  providers: AuthProvider[];
  next?: string | undefined;
  initialError?: string | undefined;
  errorProvider?: AuthProvider | undefined;
}) {
  const destination = nextPath(next);
  const [social, setSocial] = useState<AuthProvider>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError ? socialError(initialError, errorProvider) : "");
  const [notice, setNotice] = useState("");
  return (
    <main className="auth-layout">
      <section className="auth-form-side">
        <Link href="/" className="wordmark">
          <Terminal size={22} className="text-link" /> nanogent
        </Link>
        <div className="auth-form">
          <h1 className="text-[26px] font-medium tracking-tight">
            {signUp ? "Create an account" : "Sign in"}
          </h1>
          <p className="mb-7 mt-2 text-muted-foreground">
            {signUp ? "Submit tasks and keep your runs in one place." : "Continue to your runs."}
          </p>
          <div className="mb-6 space-y-3">
            {providers.map((provider) => (
              <Button
                key={provider}
                variant="outline"
                className="h-10 w-full"
                disabled={pending || !!social}
                onClick={async () => {
                  setSocial(provider);
                  setError("");
                  try {
                    const result = await authClient.signIn.social({
                      provider,
                      callbackURL: destination,
                      errorCallbackURL: `/sign-in?provider=${provider}&next=${encodeURIComponent(destination)}`,
                    });
                    if (result.error) {
                      setError(socialError(authFailure(result.error).code, provider));
                      setSocial(undefined);
                    }
                  } catch (caught) {
                    setError(socialError(authFailure(caught).code, provider));
                    setSocial(undefined);
                  }
                }}
              >
                {social === provider ? <Spinner /> : <ProviderIcon provider={provider} />}
                {social === provider
                  ? "Connecting…"
                  : `Continue with ${provider === "github" ? "GitHub" : "Google"}`}
              </Button>
            ))}
          </div>
          {providers.length > 0 && (
            <div className="mb-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || social) return;
              setPending(true);
              setError("");
              setNotice("");
              const form = new FormData(event.currentTarget);
              const email = String(form.get("email"));
              const password = String(form.get("password"));
              try {
                const result = signUp
                  ? await authClient.signUp.email({
                      email,
                      password,
                      name: String(form.get("name")),
                      callbackURL: destination,
                    })
                  : await authClient.signIn.email({ email, password });
                if (result.error) {
                  setError(emailError(authFailure(result.error), signUp));
                } else {
                  const session = await authClient.getSession();
                  if (session.data?.user) {
                    window.location.assign(destination);
                    return;
                  }
                  setNotice("Check your email to verify your account, then sign in.");
                }
              } catch (caught) {
                setError(emailError(authFailure(caught), signUp));
              }
              setPending(false);
            }}
          >
            {signUp && (
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="name">
                  Name
                </label>
                <Input id="name" name="name" autoComplete="name" required maxLength={100} />
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="email">
                Email
              </label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={signUp ? "new-password" : "current-password"}
                minLength={8}
                maxLength={128}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && <output className="block text-sm text-link">{notice}</output>}
            <Button type="submit" className="w-full" disabled={pending || !!social}>
              {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {signUp ? "Already have an account? " : "New here? "}
            <Link
              className="font-medium text-link underline underline-offset-4"
              href={`${signUp ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(destination)}`}
            >
              {signUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Run a task. Review the change.</p>
      </section>
      <TerminalDemo />
    </main>
  );
}
