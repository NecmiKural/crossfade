import { AppError } from "@/lib/core/errors";
import { actorFromRequest, requireSameOrigin } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { errorMessage, log } from "@/lib/log";
import { createScopedKey } from "@/lib/settings";

const STATUS: Record<string, number> = { forbidden: 403, invalid_request: 422, unknown_app: 422 };

/** Admin-only: create a CI key scoped to some apps. The key is returned once and stored hashed. */
export async function POST(request: Request): Promise<Response> {
  if (!requireSameOrigin(request)) return Response.json({ error: "wrong_origin" }, { status: 403 });
  const caller = await actorFromRequest(request);
  if (!caller.ok) return Response.json({ error: caller.error }, { status: caller.status });
  try {
    const created = await createScopedKey(getDb(), caller.actor, await request.json().catch(() => ({})));
    log("info", "api key created", { keyId: created.id, apps: created.apps });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.code, issues: error.details }, { status: STATUS[error.code] ?? 400 });
    log("error", "api key creation failed", { error: errorMessage(error) });
    return Response.json({ error: "key_creation_failed" }, { status: 500 });
  }
}
