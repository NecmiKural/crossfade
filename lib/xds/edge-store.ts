import { desc, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { edgeNodes, snapshots } from "@/lib/db/schema";
import type { ResourceKind, SnapshotPayload } from "@/lib/xds/discovery";

export async function latestSnapshot(db: Db): Promise<SnapshotPayload | undefined> {
  const [row] = await db
    .select({ cdsVersion: snapshots.cdsVersion, rdsVersion: snapshots.rdsVersion, clusters: snapshots.clusters, routes: snapshots.routes })
    .from(snapshots)
    .orderBy(desc(snapshots.id))
    .limit(1);
  return row;
}

export type Poll = Readonly<{
  nodeId: string;
  kind: ResourceKind;
  ackedVersion: number | null;
  servedVersion: number;
  envoyVersion: string | null;
}>;

/** Records one xDS poll. `served_since` only moves when the served version changes. */
export async function recordPoll(db: Db, poll: Poll): Promise<void> {
  const now = new Date();
  await db
    .insert(edgeNodes)
    .values({
      nodeId: poll.nodeId,
      type: poll.kind,
      ackedVersion: poll.ackedVersion,
      servedVersion: poll.servedVersion,
      servedSince: now,
      lastSeenAt: now,
      envoyVersion: poll.envoyVersion,
    })
    .onConflictDoUpdate({
      target: [edgeNodes.nodeId, edgeNodes.type],
      set: {
        ackedVersion: sql`excluded.acked_version`,
        servedSince: sql`CASE WHEN ${edgeNodes.servedVersion} = excluded.served_version THEN ${edgeNodes.servedSince} ELSE excluded.served_since END`,
        servedVersion: sql`excluded.served_version`,
        lastSeenAt: sql`excluded.last_seen_at`,
        envoyVersion: sql`excluded.envoy_version`,
      },
    });
}
