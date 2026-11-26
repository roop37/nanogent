"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-white p-8">
      <h1 className="text-xl font-semibold">Could not load your runs</h1>
      <p className="my-4 text-slate-600">Try again shortly.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
