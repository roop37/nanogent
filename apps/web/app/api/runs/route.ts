import { api } from "@/lib/server/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => api("list", request);
export const POST = (request: Request) => api("submit", request);
