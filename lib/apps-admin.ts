import { randomBytes } from "node:crypto";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { createApp, findApp, type AppRow, NewApp, NewVersion, registerVersion, type VersionRow } from "@/lib/apps";
import { AppError } from "@/lib/core/errors";
import { type Action, type Actor, actorRef, can } from "@/lib/core/policy";
import { PlanId, parseInput } from "@/lib/core/schemas";
import type { Db, Tx } from "@/lib/db/client";
import { apps, versions } from "@/lib/db/schema";
import { appendEvent } from "@/lib/events";
import { publishSnapshot } from "@/lib/xds/publish";

function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw new AppError("forbidden", "only admins can change apps");
}

async function requireApp(tx: Tx, slug: string): Promise<AppRow> {
  const app = await findApp(tx, slug);
  if (!app) throw new AppError("unknown_app", `unknown app "${slug}"`);
  return app;
}

export type AppListItem = AppRow & { stableVersion: string | null; versionCount: number };

export async function listApps(db: Db): Promise<AppListItem[]> {
  const rows = await db.select().from(apps).orderBy(asc(apps.slug));
  const counts = await db.select({ appId: versions.appId, n: count() }).from(versions).groupBy(versions.appId);
  const stable = await db.select({ id: versions.id, name: versions.name }).from(versions);
  return rows.map((app) => ({
    ...app,
    stableVersion: stable.find((v) => v.id === app.stableVersionId)?.name ?? null,
    versionCount: counts.find((c) => c.appId === app.id)?.n ?? 0,
  }));
}

export async function appDetail(db: Db, slug: string): Promise<{ app: AppRow; versions: VersionRow[] } | undefined> {
  const [app] = await db.select().from(apps).where(eq(apps.slug, slug));
  if (!app) return undefined;
  const rows = await db.select().from(versions).where(eq(versions.appId, app.id)).orderBy(asc(versions.createdAt));
  return { app, versions: rows };
}

export async function adminCreateApp(db: Db, actor: Actor, input: z.input<typeof NewApp>): Promise<AppRow> {
  assertCan(actor, { type: "app.manage" });
  return db.transaction((tx) => createApp(tx, input, actorRef(actor)));
}

export async function adminRegisterVersion(db: Db, actor: Actor, input: z.input<typeof NewVersion>): Promise<VersionRow> {
  assertCan(actor, { type: "app.manage" });
  return db.transaction((tx) => registerVersion(tx, input, actorRef(actor)));
}

export const AppSettings = z.object({ defaultPlan: PlanId, sticky: z.boolean(), requiresApproval: z.boolean().default(false) });

export async function updateAppSettings(db: Db, actor: Actor, slug: string, input: z.input<typeof AppSettings>): Promise<void> {
  assertCan(actor, { type: "app.manage" });
  const settings = parseInput(AppSettings, input);
  await db.transaction(async (tx) => {
    const app = await requireApp(tx, slug);
    await tx.update(apps).set(settings).where(eq(apps.id, app.id));
    const approvals = settings.requiresApproval ? "four-eyes approval on" : "four-eyes approval off";
    const message = `settings changed: default plan ${settings.defaultPlan}, ${settings.sticky ? "sticky" : "random"} split, ${approvals}`;
    await appendEvent(tx, { actor: actorRef(actor), appId: app.id, type: "app.updated", message, data: settings });
    await publishSnapshot(tx, { reason: `app ${slug} settings`, actor: actorRef(actor) });
  });
}

/** New tester token; the old one stops working on the next Envoy poll. */
export async function rotateTesterToken(db: Db, actor: Actor, slug: string): Promise<void> {
  assertCan(actor, { type: "app.reveal-token", app: slug });
  await db.transaction(async (tx) => {
    const app = await requireApp(tx, slug);
    await tx.update(apps).set({ testerToken: randomBytes(32).toString("hex") }).where(eq(apps.id, app.id));
    await appendEvent(tx, { actor: actorRef(actor), appId: app.id, type: "token.rotated", message: "tester token rotated" });
    await publishSnapshot(tx, { reason: `app ${slug} tester token rotated`, actor: actorRef(actor) });
  });
}

/** Shows the tester token to an admin and writes that down in the audit trail. */
export async function revealTesterToken(db: Db, actor: Actor, slug: string): Promise<string> {
  assertCan(actor, { type: "app.reveal-token", app: slug });
  return db.transaction(async (tx) => {
    const app = await requireApp(tx, slug);
    await appendEvent(tx, { actor: actorRef(actor), appId: app.id, type: "token.revealed", message: "tester token revealed" });
    return app.testerToken;
  });
}
