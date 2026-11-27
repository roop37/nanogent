"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-panel p-8">
      <h1 className="text-xl font-semibold">Could not load your runs</h1>
      <p className="my-4 text-muted-foreground">Try again shortly.</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
