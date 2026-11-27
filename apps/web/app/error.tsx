"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8" role="alert">
      <h1 className="text-xl font-medium">Could not load the workspace</h1>
      <p className="my-4 text-muted-foreground">Check your connection and try again.</p>
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
