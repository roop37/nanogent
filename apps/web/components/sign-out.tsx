"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
export function SignOut() {
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {error && (
        <span role="alert" className="text-sm text-red-700">
          Could not sign out.
        </span>
      )}
      <Button
        variant="ghost"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            const result = await authClient.signOut();
            if (result.error) throw new Error();
            window.location.assign("/sign-in");
          } catch {
            setError(true);
            setPending(false);
          }
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
