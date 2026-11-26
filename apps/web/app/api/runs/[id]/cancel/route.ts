import { api } from "@/lib/server/runtime";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api("cancel", request, (await context.params).id);
}
