import type { NextRequest } from "next/server";
import { auth } from "@/lib/server/auth";
import { testMode } from "@/lib/server/settings";
export const runtime = "nodejs";
const handler =
  (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE") =>
  (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => {
    if (testMode())
      return Response.json({ error: "Auth upstream is disabled in tests." }, { status: 503 });
    return auth().handler()[method](request, context);
  };
export const GET = handler("GET");
export const POST = handler("POST");
export const PUT = handler("PUT");
export const PATCH = handler("PATCH");
export const DELETE = handler("DELETE");
