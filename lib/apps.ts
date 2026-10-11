import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Allowlist, isAllowed } from "@/lib/core/allowlist";
import { AppError } from "@/lib/core/errors";
import { AppKey, Domain, HealthPath, Hostname, PathPrefix, PlanId, Port, Slug, VersionName } from "@/lib/core/schemas";
import type { Tx } from "@/lib/db/client";
import { apps, versions } from "@/lib/db/schema";
import { upstreamAllowlist } from "@/lib/env";
import { appendEvent } from "@/lib/events";
import { type ActorRef, publishSnapshot } from "@/lib/xds/publish";

export const NewApp = z.object({
  slug: Slug,
  key: AppKey,
  domain: Domain,
  pathPrefix: PathPrefix.default("/"),
  defaultPlan: PlanId.default("standard"),
  sticky: z.boolean().default(true),
});

export const NewVersion = z.object({
  app: Slug,
  name: VersionName,
  host: Hostname,
  port: Port,
  healthPath: HealthPath,
});

export type AppRow = typeof apps.$inferSelect;
export type VersionRow = typeof versions.$inferSelect;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError("invalid_request", "invalid input", z.flattenError(result.error).fieldErrors);
  return result.data;
}

export async function findApp(tx: Tx, slug: string): Promise<AppRow | undefined> {
  const [row] = await tx.select().from(apps).where(eq(apps.slug, slug));
  return row;
}

export async function createApp(tx: Tx, input: z.input<typeof NewApp>, actor: ActorRef): Promise<AppRow> {
  const data = parse(NewApp, input);
  const [row] = await tx
    .insert(apps)
    .values({ ...data, testerToken: randomBytes(32).toString("hex") })
    .returning();
  await appendEvent(tx, { actor, appId: row.id, type: "app.created", message: `app ${row.slug} created on ${row.domain}${row.pathPrefix}` });
  await publishSnapshot(tx, { reason: `app ${data.slug} created`, actor });
  return row;
}

/**
 * Registers an immutable version of an app. The upstream must be on the operator's allowlist
 * for that app (deny by default). The first version of an app becomes its stable version.
 */
export async function registerVersion(
  tx: Tx,
  input: z.input<typeof NewVersion>,
  actor: ActorRef,
  allowlist: Allowlist = upstreamAllowlist(),
): Promise<VersionRow> {
  const data = parse(NewVersion, input);
  const app = await findApp(tx, data.app);
  if (!app) throw new AppError("unknown_app", `unknown app "${data.app}"`);
  if (!isAllowed(allowlist, app.slug, data.host, data.port)) {
    throw new AppError("upstream_not_allowed", `${data.host}:${data.port} is not on the allowlist for ${app.slug}`);
  }
  const [row] = await tx
    .insert(versions)
    .values({ appId: app.id, name: data.name, host: data.host, port: data.port, healthPath: data.healthPath })
    .returning();
  await appendEvent(tx, {
    actor,
    appId: app.id,
    type: "version.registered",
    message: `version ${row.name} registered at ${row.host}:${row.port}`,
    data: { version: row.name, host: row.host, port: row.port },
  });
  if (!app.stableVersionId) {
    await tx.update(apps).set({ stableVersionId: row.id }).where(eq(apps.id, app.id));
  }
  await publishSnapshot(tx, { reason: `version ${app.slug}/${data.name} registered`, actor });
  return row;
}
