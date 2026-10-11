import { and, desc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { incidentKey, parseKey, releaseKey } from "@/lib/core/keys";
import type { Db } from "@/lib/db/client";
import { apps, edgeNodes, events, heartbeats, incidents, type ReleaseStatus, releases, snapshots, versions } from "@/lib/db/schema";
import { LIVE_NODE_WINDOW_MS } from "@/lib/releases/view";

export type LampTone = "ok" | "warn" | "bad" | "off";
export type Lamp = Readonly<{ tone: LampTone; label: string; detail: string }>;

/** Engine lamp: is the rollout worker ticking? */
export async function engineLamp(db: Db, now = new Date()): Promise<Lamp> {
  const [beat] = await db.select().from(heartbeats).where(eq(heartbeats.name, "engine"));
  if (!beat) return { tone: "off", label: "Engine", detail: "never ticked" };
  const age = Math.round((now.getTime() - beat.at.getTime()) / 1000);
  const tone: LampTone = age <= 10 ? "ok" : age <= 30 ? "warn" : "bad";
  return { tone, label: "Engine", detail: tone === "ok" ? "ticking" : `last tick ${age} s ago` };
}

/** Edge lamp: is at least one Envoy node polling the control plane? */
export async function edgeLamp(db: Db, now = new Date()): Promise<Lamp> {
  const live = await db
    .select({ nodeId: edgeNodes.nodeId })
    .from(edgeNodes)
    .where(and(eq(edgeNodes.type, "rds"), gt(edgeNodes.lastSeenAt, new Date(now.getTime() - LIVE_NODE_WINDOW_MS))));
  if (live.length === 0) return { tone: "bad", label: "Edge", detail: "no node polling" };
  return { tone: "ok", label: "Edge", detail: live.map((n) => n.nodeId).join(", ") };
}

const fromV = alias(versions, "from_v");
const candV = alias(versions, "cand_v");

export type ReleaseSummary = Readonly<{
  id: string;
  key: string;
  app: string;
  from: string;
  candidate: string;
  status: ReleaseStatus;
  weight: number;
  createdAt: Date;
}>;

export async function recentReleases(db: Db, limit = 50): Promise<ReleaseSummary[]> {
  const rows = await db
    .select({ release: releases, appKey: apps.key, app: apps.slug, from: fromV.name, candidate: candV.name })
    .from(releases)
    .innerJoin(apps, eq(apps.id, releases.appId))
    .innerJoin(fromV, eq(fromV.id, releases.fromVersionId))
    .innerJoin(candV, eq(candV.id, releases.candidateVersionId))
    .orderBy(desc(releases.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.release.id,
    key: releaseKey(r.appKey, r.release.number),
    app: r.app,
    from: r.from,
    candidate: r.candidate,
    status: r.release.status,
    weight: r.release.weight,
    createdAt: r.release.createdAt,
  }));
}

export type EdgeNodeRow = Readonly<{
  nodeId: string;
  envoyVersion: string | null;
  lastSeenAt: Date;
  types: ReadonlyArray<{ type: "cds" | "rds"; acked: number | null; served: number; servedSince: Date; lastSeenAt: Date }>;
}>;

export async function edgeNodesOverview(db: Db): Promise<EdgeNodeRow[]> {
  const rows = await db.select().from(edgeNodes);
  const byNode = new Map<string, EdgeNodeRow>();
  for (const row of rows) {
    const existing = byNode.get(row.nodeId);
    const entry = { type: row.type as "cds" | "rds", acked: row.ackedVersion, served: row.servedVersion, servedSince: row.servedSince, lastSeenAt: row.lastSeenAt };
    byNode.set(row.nodeId, {
      nodeId: row.nodeId,
      envoyVersion: row.envoyVersion ?? existing?.envoyVersion ?? null,
      lastSeenAt: existing && existing.lastSeenAt > row.lastSeenAt ? existing.lastSeenAt : row.lastSeenAt,
      types: [...(existing?.types ?? []), entry].sort((a, b) => a.type.localeCompare(b.type)),
    });
  }
  return [...byNode.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export async function latestSnapshotDetail(db: Db): Promise<typeof snapshots.$inferSelect | undefined> {
  const [row] = await db.select().from(snapshots).orderBy(desc(snapshots.id)).limit(1);
  return row;
}

const TERMINAL_LIMIT = 10;

export type IncidentSummary = Readonly<{
  id: string;
  key: string;
  app: string;
  title: string;
  status: "open" | "resolved";
  openedBy: string;
  resolvedBy: string | null;
  createdAt: Date;
}>;

export type BoardData = Readonly<{ releases: ReleaseSummary[]; incidents: IncidentSummary[] }>;

/** Everything active, the latest finished releases per status, and recent incidents. */
export async function boardData(db: Db): Promise<BoardData> {
  const all = await recentReleases(db, 300);
  const perStatus = new Map<string, number>();
  const releasesShown = all.filter((r) => {
    const terminal = r.status === "promoted" || r.status === "rolled_back" || r.status === "cancelled";
    if (!terminal) return true;
    const n = (perStatus.get(r.status) ?? 0) + 1;
    perStatus.set(r.status, n);
    return n <= TERMINAL_LIMIT;
  });
  return { releases: releasesShown, incidents: await recentIncidents(db, 30) };
}

const opener = alias(releases, "opener");
const resolver = alias(releases, "resolver");

export async function recentIncidents(db: Db, limit: number): Promise<IncidentSummary[]> {
  const rows = await db
    .select({ incident: incidents, appKey: apps.key, app: apps.slug, opened: opener.number, resolved: resolver.number })
    .from(incidents)
    .innerJoin(apps, eq(apps.id, incidents.appId))
    .innerJoin(opener, eq(opener.id, incidents.releaseId))
    .leftJoin(resolver, eq(resolver.id, incidents.resolvedByReleaseId))
    .orderBy(desc(incidents.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.incident.id,
    key: incidentKey(r.appKey, r.incident.number),
    app: r.app,
    title: r.incident.title,
    status: r.incident.status,
    openedBy: releaseKey(r.appKey, r.opened),
    resolvedBy: r.resolved === null ? null : releaseKey(r.appKey, r.resolved),
    createdAt: r.incident.createdAt,
  }));
}

export type IncidentDetail = Readonly<{
  summary: IncidentSummary;
  evidence: unknown;
  openedById: string;
  resolvedById: string | null;
  events: { id: number; message: string; actorKind: string; createdAt: Date }[];
}>;

export async function incidentDetail(db: Db, key: string): Promise<IncidentDetail | undefined> {
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "incident") return undefined;
  const [row] = await db
    .select({ incident: incidents, appKey: apps.key, app: apps.slug, opened: opener.number, resolved: resolver.number })
    .from(incidents)
    .innerJoin(apps, eq(apps.id, incidents.appId))
    .innerJoin(opener, eq(opener.id, incidents.releaseId))
    .leftJoin(resolver, eq(resolver.id, incidents.resolvedByReleaseId))
    .where(and(eq(apps.key, parsed.appKey), eq(incidents.number, parsed.number)));
  if (!row) return undefined;
  const trail = await db
    .select({ id: events.id, message: events.message, actorKind: events.actorKind, createdAt: events.createdAt })
    .from(events)
    .where(eq(events.incidentId, row.incident.id))
    .orderBy(events.id);
  return {
    summary: {
      id: row.incident.id,
      key,
      app: row.app,
      title: row.incident.title,
      status: row.incident.status,
      openedBy: releaseKey(row.appKey, row.opened),
      resolvedBy: row.resolved === null ? null : releaseKey(row.appKey, row.resolved),
      createdAt: row.incident.createdAt,
    },
    evidence: row.incident.evidence,
    openedById: row.incident.releaseId,
    resolvedById: row.incident.resolvedByReleaseId,
    events: trail,
  };
}
