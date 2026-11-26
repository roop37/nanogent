import { Shell } from "@/components/shell";
import { pageUser } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await pageUser();
  return <Shell>{children}</Shell>;
}
