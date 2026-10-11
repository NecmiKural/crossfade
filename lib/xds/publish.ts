import { asc, desc, gt, inArray, or, sql } from "drizzle-orm";
import { sha256Hex } from "@/lib/core/hash";
import type { ActorRef } from "@/lib/core/policy";
import type { Tx } from "@/lib/db/client";
import { apps, type ReleaseStatus, releases, snapshots, versions } from "@/lib/db/schema";
import { renderClusters, renderRoutes } from "@/lib/xds/render";
import { CLUSTER_GRACE_MS, renderedVersionIds } from "@/lib/xds/render-context";
import type { RenderApp, RenderContext } from "@/lib/xds/types";
import { validateSnapshot } from "@/lib/xds/validate";

/** Serializes snapshot writers across web, engine and migrate. */
const SNAPSHOT_LOCK = 0x63660001;

export type { ActorRef };
export type Snapshot = typeof snapshots.$inferSelect;

export class SnapshotValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`rendered Envoy config is invalid: ${problems.join("; ")}`);
    this.name = "SnapshotValidationError";
  }
}

const ACTIVE: readonly ReleaseStatus[] = ["pending_approval", "warming", "rolling", "paused"];

async function loadRenderContext(tx: Tx): Promise<RenderContext> {
  const now = new Date();
  const appRows = await tx.select().from(apps).orderBy(asc(apps.slug));
  const versionRows = await tx.select().from(versions).orderBy(asc(versions.name));
  const releaseRows = await tx
    .select()
    .from(releases)
    .where(or(inArray(releases.status, [...ACTIVE]), gt(releases.finishedAt, new Date(now.getTime() - CLUSTER_GRACE_MS))));
  const renderApps: RenderApp[] = appRows.map((app) => {
    const own = versionRows.filter((v) => v.appId === app.id);
    const ownReleases = releaseRows.filter((r) => r.appId === app.id);
    const keep = renderedVersionIds({ stableVersionId: app.stableVersionId, releases: ownReleases, now });
    const active = ownReleases.find((r) => ACTIVE.includes(r.status));
    const nameOf = (id: string) => own.find((v) => v.id === id)?.name;
    return {
      slug: app.slug,
      domain: app.domain,
      pathPrefix: app.pathPrefix,
      stableVersion: app.stableVersionId ? (nameOf(app.stableVersionId) ?? null) : null,
      sticky: app.sticky,
      testerToken: app.testerToken,
      release: active ? { status: active.status, candidate: nameOf(active.candidateVersionId) ?? "", weight: active.weight } : null,
      versions: own.filter((v) => keep.has(v.id)).map(({ name, host, port, healthPath }) => ({ name, host, port, healthPath })),
    };
  });
  return { apps: renderApps };
}

/** A version that only ever grows, even after a database restore: max(previous + 1, now in ms). */
const nextVersion = (previous: number | undefined) =>
  sql<number>`GREATEST(${previous ?? 0}::bigint + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)`;

/**
 * Renders, validates and stores the Envoy config for the current state of the transaction.
 * Call it after the mutations, inside the same transaction: a validation failure throws and
 * rolls the whole change back, so invalid config never reaches Envoy.
 */
export async function publishSnapshot(tx: Tx, input: { reason: string; actor: ActorRef }): Promise<Snapshot> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${SNAPSHOT_LOCK})`);
  const ctx = await loadRenderContext(tx);
  const clusters = renderClusters(ctx);
  const routes = renderRoutes(ctx);
  const problems = validateSnapshot(clusters, routes);
  if (problems.length > 0) throw new SnapshotValidationError(problems);

  const clustersJson = JSON.stringify(clusters);
  const routesJson = JSON.stringify([routes]);
  const cdsHash = sha256Hex(clustersJson);
  const rdsHash = sha256Hex(routesJson);
  const [latest] = await tx.select().from(snapshots).orderBy(desc(snapshots.id)).limit(1);
  if (latest && latest.cdsHash === cdsHash && latest.rdsHash === rdsHash) return latest;

  const [row] = await tx
    .insert(snapshots)
    .values({
      cdsVersion: latest?.cdsHash === cdsHash ? latest.cdsVersion : nextVersion(latest?.cdsVersion),
      rdsVersion: latest?.rdsHash === rdsHash ? latest.rdsVersion : nextVersion(latest?.rdsVersion),
      cdsHash,
      rdsHash,
      clusters: clustersJson,
      routes: routesJson,
      reason: input.reason,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
    })
    .returning();
  return row;
}
