import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Plan } from "@/lib/core/plans";
import type { Db, Tx } from "@/lib/db/client";
import { apps, edgeNodes, heartbeats, releaseSamples, releases, snapshots, versions } from "@/lib/db/schema";
import { decide } from "@/lib/engine/decide";
import { clusterStats, type ParsedStats, parseStats, STATS_FILTER } from "@/lib/engine/stats";
import type { Baseline, DecideInput, EngineStatus, HoldReason } from "@/lib/engine/types";
import { errorMessage, log } from "@/lib/log";
import { applyResult, type ReleaseRow } from "@/lib/releases/apply";
import { LIVE_NODE_WINDOW_MS } from "@/lib/releases/view";
import { clusterName } from "@/lib/xds/render";

export const TICK_MS = 2000;
const RETRY_AFTER_FAILURE_MS = 10_000;
const MAX_RELEASES_PER_TICK = 50;
const ENGINE = { kind: "engine", id: null } as const;
const DUE_STATUSES: EngineStatus[] = ["warming", "rolling", "paused"];

/** GET-only stats listener on Envoy. Never called with a transaction open. */
export async function fetchStats(baseUrl: string, token: string): Promise<ParsedStats | null> {
  try {
    const url = `${baseUrl}/stats?format=json&filter=${encodeURIComponent(STATS_FILTER)}`;
    const res = await fetch(url, { headers: { "x-crossfade-stats": token }, signal: AbortSignal.timeout(1000) });
    return res.ok ? parseStats(await res.json()) : null;
  } catch {
    return null;
  }
}

async function edgeState(db: Db, now: Date): Promise<DecideInput["edge"]> {
  const nodes = await db
    .select({ nodeId: edgeNodes.nodeId, acked: edgeNodes.ackedVersion })
    .from(edgeNodes)
    .where(and(eq(edgeNodes.type, "rds"), gt(edgeNodes.lastSeenAt, new Date(now.getTime() - LIVE_NODE_WINDOW_MS))));
  const acked = nodes.map((n) => n.acked);
  const minAckedRds = acked.length === 0 || acked.some((a) => a === null) ? null : Math.min(...(acked as number[]));
  return { liveNodeIds: nodes.map((n) => n.nodeId).sort(), minAckedRds };
}

async function claimDue(tx: Tx, now: Date): Promise<ReleaseRow | undefined> {
  const [row] = await tx
    .select()
    .from(releases)
    .where(and(inArray(releases.status, DUE_STATUSES), lte(releases.nextCheckAt, now)))
    .orderBy(asc(releases.nextCheckAt))
    .limit(1)
    .for("update", { skipLocked: true });
  return row;
}

async function decideInput(tx: Tx, release: ReleaseRow, stats: ParsedStats | null, edge: DecideInput["edge"], now: Date): Promise<DecideInput> {
  const [app] = await tx.select({ slug: apps.slug }).from(apps).where(eq(apps.id, release.appId));
  const names = await tx.select({ id: versions.id, name: versions.name }).from(versions).where(inArray(versions.id, [release.fromVersionId, release.candidateVersionId]));
  const nameOf = (id: string) => names.find((v) => v.id === id)?.name ?? "";
  const [snap] = release.snapshotId ? await tx.select({ rds: snapshots.rdsVersion }).from(snapshots).where(eq(snapshots.id, release.snapshotId)) : [];
  return {
    now,
    plan: release.plan as Plan,
    edge,
    stats: stats && {
      uptimeSeconds: stats.uptimeSeconds,
      stable: clusterStats(stats, clusterName(app.slug, nameOf(release.fromVersionId))),
      candidate: clusterStats(stats, clusterName(app.slug, nameOf(release.candidateVersionId))),
    },
    release: {
      status: release.status as EngineStatus,
      statusChangedAt: release.statusChangedAt,
      stepIndex: release.stepIndex,
      weight: release.weight,
      rdsVersion: snap?.rds ?? null,
      publishedAt: release.publishedAt,
      stepLiveAt: release.stepLiveAt,
      baseline: release.baseline as Baseline | null,
      holdReason: release.holdReason as HoldReason | null,
    },
  };
}

async function processOne(db: Db, stats: ParsedStats | null, edge: DecideInput["edge"], now: Date): Promise<string | null> {
  return db.transaction(async (tx) => {
    const release = await claimDue(tx, now);
    if (!release) return null;
    const input = await decideInput(tx, release, stats, edge, now);
    const result = decide(input);
    await applyResult(tx, release, result, ENGINE);
    const s = input.stats;
    if (s?.candidate) {
      await tx.insert(releaseSamples).values({
        releaseId: release.id,
        at: now,
        stableCompleted: s.stable?.completed ?? 0,
        stableErrors: s.stable?.errors ?? 0,
        candidateCompleted: s.candidate.completed,
        candidateErrors: s.candidate.errors,
        candidateHealthy: s.candidate.healthy,
      });
    }
    await tx.update(releases).set({ nextCheckAt: new Date(now.getTime() + TICK_MS) }).where(eq(releases.id, release.id));
    for (const event of result.events) log("info", event.message, { release: release.id, type: event.type });
    return release.id;
  });
}

/** One engine tick: stats first (no locks held), then one short transaction per due release. */
export async function runTick(db: Db, stats: ParsedStats | null, now = new Date()): Promise<number> {
  const edge = await edgeState(db, now);
  let processed = 0;
  while (processed < MAX_RELEASES_PER_TICK) {
    try {
      const id = await processOne(db, stats, edge, now);
      if (!id) break;
      processed++;
    } catch (error) {
      log("error", "release tick failed", { error: errorMessage(error) });
      // Push the oldest due release back so one bad row cannot spin the loop.
      await db.execute(sql`UPDATE releases SET next_check_at = ${new Date(now.getTime() + RETRY_AFTER_FAILURE_MS)} WHERE id = (SELECT id FROM releases WHERE status IN ('warming', 'rolling', 'paused') AND next_check_at <= ${now} ORDER BY next_check_at LIMIT 1 FOR UPDATE SKIP LOCKED)`);
      processed++;
    }
  }
  await db.insert(heartbeats).values({ name: "engine", at: now }).onConflictDoUpdate({ target: heartbeats.name, set: { at: now } });
  return processed;
}
