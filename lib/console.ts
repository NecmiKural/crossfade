import { desc, eq, gt, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { releaseKey } from "@/lib/core/keys";
import type { Db } from "@/lib/db/client";
import { apps, edgeNodes, heartbeats, type ReleaseStatus, releases, versions } from "@/lib/db/schema";
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
