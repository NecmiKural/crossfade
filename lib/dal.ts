import "server-only";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import type { Actor } from "@/lib/core/policy";
import { getDb } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { authUrl } from "@/lib/env";

/**
 * The data access layer's front door: who is calling. Every route handler and server action
 * resolves an Actor here and then asks the pure `can()` policy (lib/core/policy.ts).
 */
export type ActorResult =
  | Readonly<{ ok: true; actor: Actor }>
  | Readonly<{ ok: false; status: 401 | 429; error: string }>;

const KEY_ERRORS_429 = new Set(["RATE_LIMITED", "USAGE_EXCEEDED"]);

async function activeOwner(userId: string): Promise<{ id: string } | undefined> {
  const [owner] = await getDb().select({ id: user.id, banned: user.banned, banExpires: user.banExpires }).from(user).where(eq(user.id, userId));
  if (!owner) return undefined;
  const banned = owner.banned && (!owner.banExpires || owner.banExpires > new Date());
  return banned ? undefined : owner;
}

async function actorFromApiKey(key: string): Promise<ActorResult> {
  const result = await getAuth().api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) {
    const code = result.error?.code ?? "INVALID_API_KEY";
    return { ok: false, status: KEY_ERRORS_429.has(code) ? 429 : 401, error: code.toLowerCase() };
  }
  const owner = await activeOwner(result.key.referenceId);
  if (!owner) return { ok: false, status: 401, error: "key_owner_inactive" };
  const apps = result.key.permissions?.apps ?? [];
  return { ok: true, actor: { kind: "apikey", id: result.key.id, ownerId: owner.id, apps } };
}

/** Resolves the caller from an `x-api-key` header (CI) or the Better Auth session cookie. */
export async function actorFromRequest(request: Request): Promise<ActorResult> {
  const key = request.headers.get("x-api-key");
  if (key) return actorFromApiKey(key);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return { ok: false, status: 401, error: "unauthenticated" };
  const role = session.user.role === "admin" ? "admin" : "user";
  return {
    ok: true,
    actor: { kind: "user", id: session.user.id, role, readOnly: Boolean(session.session.impersonatedBy) },
  };
}

/** Cookie-authenticated JSON endpoints only accept requests from the dashboard origin (CSRF). */
export function requireSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(authUrl()).origin;
}
