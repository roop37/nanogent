import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <section className="run-workspace" aria-label="Loading run">
      <div className="run-header">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-3 h-8 w-1/2" />
      </div>
      <div className="run-metrics">
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="p-4 space-y-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-32" />
      </div>
    </section>
  );
}
