import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { can } from "@/lib/core/policy";
import { Slug } from "@/lib/core/schemas";
import { actorFromRequest, requireSameOrigin } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { apps } from "@/lib/db/schema";
import { errorMessage, log } from "@/lib/log";

const CreateKey = z.object({
  name: z.string().trim().min(1).max(100),
  apps: z.array(Slug).min(1).max(50),
});

/** Admin-only: create a CI key scoped to some apps. The key is returned once and stored hashed. */
export async function POST(request: Request): Promise<Response> {
  if (!requireSameOrigin(request)) return Response.json({ error: "wrong_origin" }, { status: 403 });
  const caller = await actorFromRequest(request);
  if (!caller.ok) return Response.json({ error: caller.error }, { status: caller.status });
  if (caller.actor.kind !== "user" || !can(caller.actor, { type: "settings.manage" })) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = CreateKey.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });

  const scope = [...new Set(parsed.data.apps)].sort();
  const known = await getDb().select({ slug: apps.slug }).from(apps).where(inArray(apps.slug, scope));
  if (known.length !== scope.length) return Response.json({ error: "unknown_app" }, { status: 422 });

  try {
    // Called server-side (no headers), so the plugin accepts the server-only `permissions` property.
    const created = await getAuth().api.createApiKey({
      body: { name: parsed.data.name, userId: caller.actor.id, permissions: { apps: scope } },
    });
    log("info", "api key created", { keyId: created.id, owner: caller.actor.id, apps: scope });
    return Response.json({ id: created.id, key: created.key, apps: scope }, { status: 201 });
  } catch (error) {
    log("error", "api key creation failed", { error: errorMessage(error) });
    return Response.json({ error: "key_creation_failed" }, { status: 500 });
  }
}
