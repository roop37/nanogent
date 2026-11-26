import { RunIdSchema } from "@nanogent/core";
import { notFound } from "next/navigation";
import { LiveRun } from "@/components/live-run";
import { pageUser } from "@/lib/server/auth";
import { withBackend } from "@/lib/server/runtime";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dispatch?: string }>;
}) {
  const user = await pageUser();
  const { id } = await params;
  if (!RunIdSchema.safeParse(id).success) notFound();
  const run = await withBackend((backend) => backend.get(user.id, id));
  if (!run) notFound();
  return (
    <LiveRun key={id} initial={run} dispatchPending={(await searchParams).dispatch === "pending"} />
  );
}
