import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { events, releaseSamples } from "@/lib/db/schema";
import { releaseView, type ReleaseStatusView } from "@/lib/releases/view";

const SAMPLE_WINDOW = 150; // 5 minutes at one sample per 2 s tick

export type TimelineEntry = Readonly<{ id: number; type: string; message: string; actorKind: string; actorId: string | null; createdAt: Date }>;

export type ReleasePageData = Readonly<{
  view: ReleaseStatusView;
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
  return { appSlug: found.appSlug, createdByUserId: found.createdByUserId, data: { view: found.view, samples: recent.reverse(), timeline } };
}
