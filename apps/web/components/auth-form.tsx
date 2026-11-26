"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
export function AuthForm({ signUp = false }: { signUp?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <p className="mb-10 text-center text-2xl font-bold tracking-tight">
        nanogent<span className="text-indigo-600">.</span>
      </p>
      <Card>
        <CardContent className="pt-7">
          <h1 className="text-2xl font-semibold">{signUp ? "Create an account" : "Sign in"}</h1>
          <p className="mb-7 mt-2 text-slate-600">
            {signUp ? "Submit tasks and keep your runs in one place." : "Continue to your runs."}
          </p>
          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
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
                      callbackURL: "/",
                    })
                  : await authClient.signIn.email({ email, password });
                if (result.error) {
                  setError(
                    result.error.code === "INVALID_EMAIL_OR_PASSWORD"
                      ? "Email or password is incorrect."
                      : signUp
                        ? "Could not create your account. Check your details and try again."
                        : "Could not sign in. Check your details or verify your email.",
                  );
                } else {
                  const session = await authClient.getSession();
                  if (session.data?.user) {
                    window.location.assign("/");
                    return;
                  }
                  setNotice("Check your email to verify your account, then sign in.");
                }
              } catch {
                setError("Could not connect. Try again shortly.");
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
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {notice && <output className="block text-sm text-indigo-700">{notice}</output>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">
            {signUp ? "Already have an account? " : "New here? "}
            <Link
              className="font-medium text-indigo-700 underline underline-offset-4"
              href={signUp ? "/sign-in" : "/sign-up"}
            >
              {signUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
