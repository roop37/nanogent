import { getSession } from "@/lib/server/auth";
import { HttpError, requireSameOrigin, requireUser } from "@/lib/server/guard";
import { withProjectStore } from "@/lib/server/project-store";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = requireUser(await getSession());
    await withProjectStore((store) => store.disconnect(user.id));
    return new Response(null, {
      status: 303,
      headers: { Location: "/projects", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Could not disconnect GitHub." },
      {
        status: error instanceof HttpError ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
