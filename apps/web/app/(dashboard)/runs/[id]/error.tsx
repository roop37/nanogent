"use client";
import { Button } from "@/components/ui/button";
export default function RunError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="max-w-xl p-6">
      <h1 className="text-xl font-medium">Could not load the run</h1>
      <p className="my-4 text-muted-foreground">Check your connection and try again.</p>
      <Button onClick={retry}>Try again</Button>
    </section>
  );
}
