import { authUrl, requireSecret } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";
import { runSetup } from "@/lib/setup";

/** POST {token, name, email, password}: one-time creation of the first admin. */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("host") !== new URL(authUrl()).host) {
    return Response.json({ error: "wrong_origin" }, { status: 400 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "json_required" }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => undefined);
  try {
    const result = await runSetup(body, requireSecret("SETUP_TOKEN"));
    if (result.status === 201) log("info", "first admin created", { userId: result.userId });
    return Response.json(result, { status: result.status });
  } catch (error) {
    log("error", "setup failed", { error: errorMessage(error) });
    return Response.json({ error: "setup_failed" }, { status: 500 });
  }
}
