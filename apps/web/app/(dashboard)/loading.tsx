import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <section aria-label="Loading workspace" className="space-y-6">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-12" />
      <Skeleton className="h-[55vh]" />
    </section>
  );
}
