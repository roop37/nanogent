import { api } from "@/lib/server/runtime";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api("events", request, (await context.params).id);
}
