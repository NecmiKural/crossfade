import { z } from "zod";
import { AppError } from "@/lib/core/errors";
import { can } from "@/lib/core/policy";
import { actorFromRequest, requireSameOrigin } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { errorMessage, log } from "@/lib/log";
import { createRelease } from "@/lib/releases/create";
import { releaseView } from "@/lib/releases/view";

type Ctx = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<string, number> = {
  invalid_request: 422,
  unknown_app: 422,
  unknown_version: 422,
  upstream_not_allowed: 422,
  plan_not_allowed: 422,
  candidate_is_stable: 422,
  no_stable_version: 422,
  app_not_allowed: 403,
  id_conflict: 409,
  active_release: 409,
  version_conflict: 409,
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers });

async function authenticate(request: Request) {
  const caller = await actorFromRequest(request);
  if (!caller.ok) return { ok: false as const, response: json({ error: caller.error }, caller.status) };
  // Browsers authenticate with cookies, so writes need a same-origin check (CSRF); CI keys do not.
  if (caller.actor.kind === "user" && request.method !== "GET" && !requireSameOrigin(request)) {
    return { ok: false as const, response: json({ error: "wrong_origin" }, 403) };
  }
  return caller;
}

/** OSB-style async create: 202 + Location, then poll GET until terminal && applied. */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const id = (await ctx.params).id;
  if (!z.uuid().safeParse(id).success) return json({ error: "invalid_id", message: "use a client-generated UUID" }, 400);
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.actor.kind !== "user" && auth.actor.kind !== "apikey") return json({ error: "forbidden" }, 403);
  const body: unknown = await request.json().catch(() => undefined);
  try {
    const result = await createRelease(getDb(), { id, body, actor: auth.actor });
    const found = await releaseView(getDb(), result.releaseId);
    const headers = { location: `/api/v1/releases/${id}`, "retry-after": "2" };
    return json(found?.view, result.created ? 202 : 200, headers);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.code, message: error.message, details: error.details }, STATUS_BY_CODE[error.code] ?? 400);
    log("error", "release create failed", { id, error: errorMessage(error) });
    return json({ error: "internal_error" }, 500);
  }
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const id = (await ctx.params).id;
  if (!z.uuid().safeParse(id).success) return json({ error: "not_found" }, 404);
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const found = await releaseView(getDb(), id);
  // Unknown and not-allowed look the same, so keys cannot probe other apps.
  if (!found || !can(auth.actor, { type: "release.read", app: found.appSlug })) return json({ error: "not_found" }, 404);
  return json(found.view, 200, found.view.terminal ? {} : { "retry-after": "2" });
}
