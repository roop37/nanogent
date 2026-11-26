import { AuthForm } from "@/components/auth-form";
import { parseProviders } from "@/lib/auth-options";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; provider?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthForm
      providers={parseProviders(process.env.NANOGENT_AUTH_PROVIDERS)}
      next={params.next}
      initialError={params.error}
      errorProvider={
        params.provider === "github" || params.provider === "google" ? params.provider : undefined
      }
    />
  );
}
