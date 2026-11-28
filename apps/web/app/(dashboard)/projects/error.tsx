"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-8">
      <h1 className="text-xl font-medium">Could not load your GitHub projects</h1>
      <p className="text-muted-foreground">Try again shortly.</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
