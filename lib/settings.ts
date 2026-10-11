import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { AppError } from "@/lib/core/errors";
import { type Actor, actorRef, can } from "@/lib/core/policy";
import { Password, parseInput, Slug } from "@/lib/core/schemas";
import type { Db } from "@/lib/db/client";
import { apikey, apps, user } from "@/lib/db/schema";
import { appendEvent } from "@/lib/events";

function assertAdmin(actor: Actor): void {
  if (!can(actor, { type: "settings.manage" })) throw new AppError("forbidden", "only admins can manage users and keys");
}

export const NewUser = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  // Better Auth's admin createUser only checks the maximum length, so the minimum lives here.
  password: Password,
  role: z.enum(["admin", "user"]).default("user"),
});

export async function listUsers(db: Db) {
  return db.select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned, createdAt: user.createdAt }).from(user).orderBy(user.createdAt);
}

/** Admin-only. With the admin's request headers, Better Auth checks the role a second time. */
export async function addUser(db: Db, actor: Actor, input: z.input<typeof NewUser>, headers?: Headers): Promise<{ id: string }> {
  assertAdmin(actor);
  const data = parseInput(NewUser, input);
  const exists = await db.select({ id: user.id }).from(user).where(eq(user.email, data.email.toLowerCase()));
  if (exists.length > 0) throw new AppError("email_taken", "a user with this email already exists");
  const created = await getAuth().api.createUser({ body: data, ...(headers ? { headers } : {}) });
  await db.transaction((tx) => appendEvent(tx, { actor: actorRef(actor), type: "user.created", message: `user ${data.email} created (${data.role})` }));
  return { id: created.user.id };
}

export const NewKey = z.object({ name: z.string().trim().min(1).max(100), apps: z.array(Slug).min(1).max(50) });

/** Admin-only: a CI key scoped to some apps. The plaintext key is returned once; only its hash is stored. */
export async function createScopedKey(db: Db, actor: Actor, input: z.input<typeof NewKey>): Promise<{ id: string; key: string; apps: string[] }> {
  assertAdmin(actor);
  if (actor.kind !== "user") throw new AppError("forbidden", "keys are owned by people");
  const data = parseInput(NewKey, input);
  const scope = [...new Set(data.apps)].sort();
  const known = await db.select({ slug: apps.slug }).from(apps).where(inArray(apps.slug, scope));
  if (known.length !== scope.length) throw new AppError("unknown_app", "every app in the scope must exist");
  // Server-side call (no headers), so the plugin accepts the server-only `permissions` property.
  const created = await getAuth().api.createApiKey({ body: { name: data.name, userId: actor.id, permissions: { apps: scope } } });
  await db.transaction((tx) => appendEvent(tx, { actor: actorRef(actor), type: "key.created", message: `API key "${data.name}" created for ${scope.join(", ")}` }));
  return { id: created.id, key: created.key, apps: scope };
}

/** The apps a key may release, as stored by the plugin; anything unreadable lists as no apps. */
function scopeOf(permissions: string | null): string[] {
  try {
    const apps: unknown = JSON.parse(permissions ?? "{}")?.apps;
    return Array.isArray(apps) ? apps.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
}

export async function listKeys(db: Db) {
  const rows = await db
    .select({ id: apikey.id, name: apikey.name, start: apikey.start, enabled: apikey.enabled, permissions: apikey.permissions, owner: user.email, createdAt: apikey.createdAt, lastRequest: apikey.lastRequest })
    .from(apikey)
    .leftJoin(user, eq(user.id, apikey.referenceId))
    .orderBy(desc(apikey.createdAt));
  return rows.map((r) => ({ ...r, apps: scopeOf(r.permissions) }));
}

/** Disables a key (kept for the audit trail); it stops working on the next request. */
export async function revokeKey(db: Db, actor: Actor, keyId: string): Promise<void> {
  assertAdmin(actor);
  const [row] = await db.select({ id: apikey.id, name: apikey.name, owner: apikey.referenceId }).from(apikey).where(eq(apikey.id, keyId));
  if (!row) throw new AppError("not_found", "key not found");
  await getAuth().api.updateApiKey({ body: { keyId, userId: row.owner, enabled: false } });
  await db.transaction((tx) => appendEvent(tx, { actor: actorRef(actor), type: "key.revoked", message: `API key "${row.name ?? keyId}" revoked` }));
}
