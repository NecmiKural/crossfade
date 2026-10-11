import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { apps, events, releaseSamples, releases, snapshots } from "@/lib/db/schema";
import { releaseView, type ReleaseStatusView } from "@/lib/releases/view";

const SAMPLE_WINDOW = 150; // 5 minutes at one sample per 2 s tick

export type TimelineEntry = Readonly<{ id: number; type: string; message: string; actorKind: string; actorId: string | null; createdAt: Date }>;

export type InspectSource = Readonly<{
  domain: string;
  pathPrefix: string;
  sticky: boolean;
  snapshot: { id: number; cdsVersion: number; rdsVersion: number; clusters: string; routes: string } | null;
}>;

export type ReleasePageData = Readonly<{
  view: ReleaseStatusView;
  inspect: InspectSource;
  samples: (typeof releaseSamples.$inferSelect)[];
  timeline: TimelineEntry[];
}>;

export async function releasePageData(db: Db, id: string): Promise<{ appSlug: string; createdByUserId: string; data: ReleasePageData } | undefined> {
  const found = await releaseView(db, id);
  if (!found) return undefined;
  const recent = await db.select().from(releaseSamples).where(eq(releaseSamples.releaseId, id)).orderBy(desc(releaseSamples.id)).limit(SAMPLE_WINDOW);
  const timeline = await db
    .select({ id: events.id, type: events.type, message: events.message, actorKind: events.actorKind, actorId: events.actorId, createdAt: events.createdAt })
    .from(events)
    .where(eq(events.releaseId, id))
    .orderBy(asc(events.id));
  const [source] = await db
    .select({ domain: apps.domain, pathPrefix: apps.pathPrefix, sticky: apps.sticky, snapshot: snapshots })
    .from(releases)
    .innerJoin(apps, eq(apps.id, releases.appId))
    .leftJoin(snapshots, eq(snapshots.id, releases.snapshotId))
    .where(eq(releases.id, id));
  const snap = source.snapshot;
  const inspect: InspectSource = {
    domain: source.domain,
    pathPrefix: source.pathPrefix,
    sticky: source.sticky,
    snapshot: snap ? { id: snap.id, cdsVersion: snap.cdsVersion, rdsVersion: snap.rdsVersion, clusters: snap.clusters, routes: snap.routes } : null,
  };
  return { appSlug: found.appSlug, createdByUserId: found.createdByUserId, data: { view: found.view, inspect, samples: recent.reverse(), timeline } };
}
